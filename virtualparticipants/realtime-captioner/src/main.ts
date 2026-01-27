import { ivsClientOverrides } from '@internal';
import StageFactory from '@stage';
import { speechRecognitionIntegration } from '@utils/speech-recognition-integration';
import { LogLevels } from 'amazon-ivs-web-broadcast';

import CaptionerStage from './stage/Stage';
import {
  VirtualParticipant,
  VirtualParticipantStatus,
  VirtualParticipantSubscriptionData
} from './types/virtual-participant.types';

ivsClientOverrides.setClientOverrideValue('logLevel', LogLevels.INFO);

const testToken = new URLSearchParams(window.location.search).get('token');

// Initialize WebSocket connection for VP status updates
let websocket: WebSocket | null = null;
let stage: CaptionerStage | undefined;

// State management for preventing duplicate initialization
let isInitializingStage = false;
let currentVpId: string | null = null;
let initializationPromise: Promise<void> | null = null;

// Debounce mechanism for VP updates
let vpUpdateTimeout: NodeJS.Timeout | null = null;
const VP_UPDATE_DEBOUNCE_MS = 1000;

// Initialize Speech Recognition integration
async function initializeSpeechRecognition(): Promise<void> {
  try {
    console.info(
      '[initializeSpeechRecognition] Starting Speech Recognition integration initialization'
    );

    await speechRecognitionIntegration.initialize();
    console.info(
      '[initializeSpeechRecognition] Speech Recognition integration initialized successfully'
    );
    console.info(
      `[initializeSpeechRecognition] Using ${speechRecognitionIntegration.isUsingLocalProcessing ? 'local' : 'cloud-based'} processing`
    );
  } catch (error) {
    console.error(
      '[initializeSpeechRecognition] Speech Recognition integration not available:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

// Create a blank video stream for SEI message transport
// Uses continuous frame generation to ensure video frames are available for SEI embedding
function createDummyVideoStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 320; // Low resolution to minimize resource usage
  canvas.height = 240;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas');
  }

  // Function to draw black frame continuously
  const drawFrame = () => {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  // Draw initial frame
  drawFrame();

  // Capture stream at 15 fps
  const stream = canvas.captureStream(15);

  // Continue drawing frames to keep the video track active
  // This is critical for SEI message embedding - SEI data needs active video frames
  const intervalId = setInterval(drawFrame, 1000 / 15); // 15 fps = ~67ms

  // Store interval ID on the stream for potential cleanup
  (
    stream as MediaStream & { __drawIntervalId?: NodeJS.Timeout }
  ).__drawIntervalId = intervalId;

  console.info(
    '[createDummyVideoStream] Created blank video stream with continuous drawing',
    JSON.stringify({
      resolution: `${canvas.width}x${canvas.height}`,
      framerate: '15 fps',
      streamId: stream.id,
      videoTracks: stream.getVideoTracks().length,
      continuousDrawing: true
    })
  );

  return stream;
}

async function loadStage(): Promise<void> {
  if (!stage) {
    console.error('loadStage: No Stage');

    return;
  }

  try {
    console.info('[loadStage] Creating dummy video stream for SEI messages');
    const videoStream = createDummyVideoStream();

    console.info('[loadStage] Initializing Speech Recognition integration');
    await initializeSpeechRecognition();

    console.info('[loadStage] Joining stage and publishing video stream');
    await stage.join(videoStream);

    console.info('[loadStage] Stage setup completed successfully');
  } catch (error) {
    console.error('[loadStage] Failed to set up stage:', error);
    throw error;
  }
}

// Initialize stage
async function initializeStage(vpInfo: VirtualParticipant): Promise<void> {
  // If a stage already exists, stop execution
  if (stage) {
    console.info('handleVpUpdate: Skipping stage creation, one already exists');

    return;
  }

  try {
    console.info('[initializeStage] Creating stage');
    stage = StageFactory.create(vpInfo.participantToken!, websocket);

    console.info('[initializeStage] Setting up stage');
    await loadStage();

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

    speechRecognitionIntegration.disconnect();

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
        '[handleVpInvitation] Previous initialization failed, proceeding with new VP',
        vpInfo.id,
        ':',
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
      speechRecognitionIntegration.disconnect();
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
