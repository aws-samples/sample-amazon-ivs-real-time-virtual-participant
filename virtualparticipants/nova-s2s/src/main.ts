import { ivsClientOverrides } from '@internal';
import StageFactory from '@stage';
import { createAudioParticipant, deleteAudioElems } from '@utils/ai.utils';
import { novaS2SIntegration } from '@utils/nova-s2s-integration';
import { LogLevels } from 'amazon-ivs-web-broadcast';

import DealerStage from './stage/Stage';
import {
  VirtualParticipant,
  VirtualParticipantStatus,
  VirtualParticipantSubscriptionData
} from './types/virtual-participant.types';

ivsClientOverrides.setClientOverrideValue('logLevel', LogLevels.INFO);

// Function to wake up PulseAudio by creating a dummy audio context
async function wakeupPulseAudio(): Promise<void> {
  try {
    console.info(
      '[wakeupPulseAudio] Creating dummy audio context to initialize PulseAudio'
    );

    // Create audio context
    const audioContext = new (window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext)();

    // Create a silent gain node
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);

    // Create an oscillator for very brief audio generation
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime);

    // Connect the nodes
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Start and stop the oscillator very quickly to establish PulseAudio connection
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.01); // 10ms burst

    // Wait a moment for the connection to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Clean up
    await audioContext.close();

    console.info('[wakeupPulseAudio] PulseAudio wakeup completed successfully');
  } catch (error) {
    console.warn('[wakeupPulseAudio] Failed to wake up PulseAudio:', error);
    // Don't throw - this is a best-effort initialization
  }
}

const testToken = new URLSearchParams(window.location.search).get('token');

// Initialize WebSocket connection for VP status updates
let websocket: WebSocket | null = null;
let stage: DealerStage | undefined;

// State management for preventing duplicate initialization
let isInitializingStage = false;
let currentVpId: string | null = null;
let initializationPromise: Promise<void> | null = null;

// Debounce mechanism for VP updates
let vpUpdateTimeout: NodeJS.Timeout | null = null;
const VP_UPDATE_DEBOUNCE_MS = 1000;

// Initialize Nova S2S integration
async function initializeNovaS2S(
  audioElem: HTMLAudioElement,
  vpParticipantId?: string,
  vpParticipantName?: string
): Promise<void> {
  try {
    console.info(
      '[initializeNovaS2S] Starting Nova S2S integration initialization'
    );

    await novaS2SIntegration.initialize(
      audioElem,
      vpParticipantId,
      vpParticipantName
    );
    console.info(
      '[initializeNovaS2S] Nova S2S integration initialized successfully'
    );
  } catch (error) {
    console.error(
      '[initializeNovaS2S] Nova S2S integration not available:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function loadStageWithAudioVideo(
  vpParticipantId?: string,
  vpParticipantName?: string
): Promise<void> {
  if (!stage) {
    console.error('loadStageWithAudioVideo: No Stage');

    return;
  }

  let audioCaptureSuccessful = false;
  let captureError: Error | null = null;

  try {
    console.info('[loadStageWithAudioVideo] Creating audio participant');

    // Create audio participant with error handling callbacks
    const audioParticipant = createAudioParticipant(stage, {
      onStreamReady: (_stream) => {
        console.info(
          '[loadStageWithAudioVideo] Audio stream ready for publishing'
        );
        audioCaptureSuccessful = true;
      },
      onError: (error) => {
        console.error('[loadStageWithAudioVideo] Audio capture error:', error);
        captureError = error;
        audioCaptureSuccessful = false;
      }
    });

    console.info('[loadStageWithAudioVideo] Initializing Nova S2S integration');

    // Initialize Nova S2S with the audio element and VP participant info for SEI messages
    await initializeNovaS2S(
      audioParticipant.element,
      vpParticipantId,
      vpParticipantName
    );

    // Start the audio capture process immediately after Nova S2S initialization
    console.info('[loadStageWithAudioVideo] Starting audio capture');
    await audioParticipant.startCapture();

    // Check if audio capture was actually successful
    if (captureError) {
      throw captureError as Error;
    }

    if (!audioCaptureSuccessful) {
      throw new Error('Audio capture did not complete successfully');
    }

    console.info(
      '[loadStageWithAudioVideo] Audio setup completed successfully - all components working'
    );
  } catch (error) {
    console.error('[loadStageWithAudioVideo] Failed to set up audio:', error);

    // Add detailed error context for debugging
    console.error('[loadStageWithAudioVideo] Error context:', {
      audioCaptureSuccessful,
      hadCaptureError: !!captureError
    });

    throw error;
  }
}

// Initialize stage with audio
async function initializeStage(vpInfo: VirtualParticipant): Promise<void> {
  // If a stage already exists, stop execution
  if (stage) {
    console.info('handleVpUpdate: Skipping stage creation, one already exists');

    return;
  }

  try {
    console.info('[initializeStage] Creating stage');
    stage = StageFactory.create(vpInfo.participantToken!, websocket);

    console.info('[initializeStage] Setting up audio');
    await loadStageWithAudioVideo(vpInfo.participantId, 'Virtual Participant');

    console.info('[initializeStage] Stage initialization completed');
  } catch (error) {
    console.error(
      '[initializeStage] Error during stage initialization:',
      error
    );

    // Clean up on error
    if (stage) {
      try {
        StageFactory.destroyStages();
        stage = undefined;
      } catch (cleanupError) {
        console.error('[initializeStage] Error during cleanup:', cleanupError);
      }
    }

    throw error;
  }
}

function handleVpUpdate(update: VirtualParticipantSubscriptionData): void {
  const { onVirtualParticipantStateChanged: vpInfo } = update;
  if (!vpInfo) return;

  console.info(
    `[handleVpUpdate] Received VP update for ${vpInfo.id}, status: ${vpInfo.status}`
  );

  if (vpInfo.status === VirtualParticipantStatus.INVITED) {
    if (!vpInfo.participantToken) {
      console.error('handleVpUpdate: No ParticipantToken');

      return;
    }

    // Clear any existing debounce timeout
    if (vpUpdateTimeout) {
      clearTimeout(vpUpdateTimeout);
    }

    // Debounce VP updates to prevent duplicate processing
    vpUpdateTimeout = setTimeout(async () => {
      try {
        await handleVpInvitation(vpInfo);
      } catch (error) {
        console.error(
          'handleVpUpdate: Failed to process VP invitation:',
          error
        );
        sendVpError('Failed to process VP invitation', {
          error: error instanceof Error ? error.message : String(error),
          vpInfo
        });
      }
    }, VP_UPDATE_DEBOUNCE_MS);
  } else if (vpInfo.status === VirtualParticipantStatus.KICKED) {
    console.info('handleVpUpdate: Kicking participant from stage');

    // Clear debounce timeout and reset state
    if (vpUpdateTimeout) {
      clearTimeout(vpUpdateTimeout);
      vpUpdateTimeout = null;
    }

    isInitializingStage = false;
    currentVpId = null;
    initializationPromise = null;

    deleteAudioElems();
    novaS2SIntegration.cleanup();

    if (!stage) {
      console.error('handleVpUpdate: No Stage');

      return;
    }

    StageFactory.destroyStages();
    stage = undefined;

    sendVpLeftStage();
  }
}

/**
 * Handle VP invitation with duplicate prevention
 */
async function handleVpInvitation(vpInfo: VirtualParticipant): Promise<void> {
  // Prevent duplicate invitations for the same VP
  if (currentVpId === vpInfo.id && (stage || isInitializingStage)) {
    console.info(
      `[handleVpInvitation] Ignoring duplicate invitation for VP ${vpInfo.id} - already processed or in progress`
    );

    return;
  }

  // If we're already initializing for a different VP, wait for it to complete or fail
  if (isInitializingStage && initializationPromise) {
    console.info(
      `[handleVpInvitation] Waiting for existing initialization to complete before processing VP ${vpInfo.id}`
    );
    try {
      await initializationPromise;
    } catch (error) {
      console.warn(
        `[handleVpInvitation] Previous initialization failed, proceeding with new VP ${vpInfo.id}:`,
        error
      );
    }
  }

  // If a stage already exists for a different VP, clean it up first
  if (stage && currentVpId && currentVpId !== vpInfo.id) {
    console.info(
      `[handleVpInvitation] Cleaning up existing stage for VP ${currentVpId} before initializing new one for ${vpInfo.id}`
    );
    try {
      deleteAudioElems();
      novaS2SIntegration.cleanup();
      StageFactory.destroyStages();
      stage = undefined;
      currentVpId = null;
    } catch (cleanupError) {
      console.error(`[handleVpInvitation] Error during cleanup:`, cleanupError);
    }
  }

  // Set state before starting initialization
  isInitializingStage = true;
  currentVpId = vpInfo.id;

  console.info(
    `[handleVpInvitation] Starting stage initialization for VP ${vpInfo.id}`
  );

  try {
    await wakeupPulseAudio(); // Wake up PulseAudio early to establish audio subsystem connection
    console.info('[handleVpInvitation] Woke up PulseAudio');
  } catch (error) {
    console.warn(
      '[handleVpInvitation] Failed to wake up PulseAudio during initialization:',
      error
    );
  }

  // Create initialization promise
  initializationPromise = initializeStage(vpInfo)
    // eslint-disable-next-line promise/always-return
    .then(() => {
      console.info(
        `[handleVpInvitation] Successfully initialized stage for VP ${vpInfo.id}`
      );
      sendVpJoinedStage(vpInfo.stageArn, vpInfo.participantToken);
    })
    .catch((error) => {
      console.error(
        `[handleVpInvitation] Failed to initialize stage for VP ${vpInfo.id}:`,
        error
      );

      // Clean up on failure
      if (stage) {
        try {
          StageFactory.destroyStages();
          stage = undefined;
        } catch (cleanupError) {
          console.error(
            `[handleVpInvitation] Error during error cleanup:`,
            cleanupError
          );
        }
      }

      // Reset state
      currentVpId = null;

      // Re-throw to let caller handle
      throw error;
    })
    .finally(() => {
      isInitializingStage = false;
      initializationPromise = null;
    });

  await initializationPromise;
}

function initializeWebSocket() {
  try {
    console.info('Initializing WebSocket connection...');

    websocket = new WebSocket('ws://localhost:3001');

    websocket.onopen = () => {
      console.info('WebSocket connected to VP server');

      // Send ready message when page loads and is ready to join a stage
      websocket?.send(
        JSON.stringify({
          type: 'vp.ready',
          metadata: {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
          }
        })
      );

      // Subscribe to virtual participant updates in GraphQL
      websocket?.send(
        JSON.stringify({
          type: 'vp.subscribe_vp'
        })
      );
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.info('Received WebSocket message:', message);

        // Handle different message types from the server
        switch (message.type) {
          case 'vp.update':
            handleVpUpdate(message.data);
            break;
          case 'vp.status_updated':
            console.info(`VP status updated to: ${message.status}`);
            break;
          case 'error':
            console.error('WebSocket error:', message.error);
            break;
          default:
            console.info('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    websocket.onclose = (event) => {
      console.info('WebSocket connection closed:', event.code, event.reason);

      // Attempt to reconnect after a delay
      setTimeout(() => {
        console.info('Attempting to reconnect WebSocket...');
        initializeWebSocket();
      }, 5000);
    };
  } catch (error) {
    console.error('Failed to initialize WebSocket:', error);
  }
}

// Function to send VP status updates
function sendVpStatusUpdate(
  status: string,
  metadata?: Record<string, unknown>
) {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(
      JSON.stringify({
        type: 'vp.status_update',
        status,
        metadata: {
          timestamp: new Date().toISOString(),
          ...metadata
        }
      })
    );
  } else {
    console.warn('WebSocket not connected, cannot send status update');
  }
}

// Function to notify when VP joins a stage
function sendVpJoinedStage(stageArn?: string, participantId?: string) {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(
      JSON.stringify({
        type: 'vp.joined_stage',
        stageArn,
        participantId,
        metadata: {
          timestamp: new Date().toISOString()
        }
      })
    );
  }
}

// Function to notify when VP leaves a stage
function sendVpLeftStage() {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'vp.left_stage' }));
  }
}

// Function to report errors
function sendVpError(error: string, metadata?: Record<string, unknown>) {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(
      JSON.stringify({
        type: 'vp.error',
        error,
        metadata: {
          timestamp: new Date().toISOString(),
          ...metadata
        }
      })
    );
  }
}

// Initialize WebSocket connection
initializeWebSocket();

// Wake up PulseAudio early to establish audio subsystem connection
wakeupPulseAudio().catch((error) => {
  console.warn(
    '[main] Failed to wake up PulseAudio during initialization:',
    error
  );
});

// Function to handle test token initialization on click
async function handleTestTokenClick(): Promise<void> {
  if (testToken) {
    const testVp: VirtualParticipant = {
      id: 'TEST_VP',
      status: VirtualParticipantStatus.AVAILABLE,
      taskId: 'TEST',
      updatedAt: 'TEST',
      participantToken: testToken,
      stageArn: 'TEST'
    };

    try {
      await initializeStage(testVp);
      console.info('Test stage initialized successfully');
    } catch (error) {
      console.error('Failed to initialize test stage:', error);
    }

    // Remove the click listener after first use to prevent multiple initializations
    document.removeEventListener('click', handleTestTokenClick);
  }
}

// Add click event listener to run testToken code when user clicks on the page
if (testToken) {
  document.addEventListener('click', handleTestTokenClick);
  console.info(
    'Click anywhere on the page to initialize test stage with token'
  );
}

// Make functions available globally for debugging
(window as Record<string, unknown>).sendVpStatusUpdate = sendVpStatusUpdate;
(window as Record<string, unknown>).sendVpJoinedStage = sendVpJoinedStage;
(window as Record<string, unknown>).sendVpLeftStage = sendVpLeftStage;
(window as Record<string, unknown>).sendVpError = sendVpError;

// Periodically notify pptr of the current local publishers
(async function sendHeartbeat() {
  const envTokens = await window.getTokens();
  if (envTokens.length) {
    const testVp: VirtualParticipant = {
      id: 'TEST_VP',
      status: VirtualParticipantStatus.AVAILABLE,
      taskId: 'TEST',
      updatedAt: 'TEST',
      participantToken: envTokens[0],
      stageArn: 'TEST'
    };

    try {
      await initializeStage(testVp);
      console.info('Test stage initialized successfully');
    } catch (error) {
      console.error('Failed to initialize test stage:', error);
    }
  }

  await window.heartbeat(StageFactory.localPublishers);
  setTimeout(sendHeartbeat, 10_000);
})();
