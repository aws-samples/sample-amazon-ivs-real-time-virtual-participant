import { ivsClientOverrides } from '@internal';
import StageFactory from '@stage';
import { createVideo, deleteVideos } from '@utils/virtualparticipant.utils';
import { LogLevels } from 'amazon-ivs-web-broadcast';

import VpStage from './stage/Stage';
import {
  VirtualParticipantStatus,
  VirtualParticipantSubscriptionData
} from './types/virtual-participant.types';

ivsClientOverrides.setClientOverrideValue('logLevel', LogLevels.INFO);

// Initialize WebSocket connection for VP status updates
let websocket: WebSocket | null = null;
let stage: VpStage | undefined;

function handleVpUpdate(update: VirtualParticipantSubscriptionData) {
  const { onVirtualParticipantStateChanged: vpInfo } = update;
  if (!vpInfo) return;

  if (vpInfo.status === VirtualParticipantStatus.INVITED) {
    if (!vpInfo.participantToken) {
      console.error('handleVpUpdate: No ParticipantToken');

      return;
    }

    // If a stage already exists, stop execution
    if (stage) {
      console.info(
        'handleVpUpdate: Skipping stage creation, one already exists'
      );

      return;
    }

    stage = StageFactory.create(vpInfo.participantToken, websocket);

    const videoAssetUrl = vpInfo.assetName
      ? `/${vpInfo.assetName}`
      : '/video-1.mp4';

    console.info('Loading video asset: ', videoAssetUrl);

    createVideo(videoAssetUrl, stage);
  } else if (vpInfo.status === VirtualParticipantStatus.KICKED) {
    console.info('handleVpUpdate: Kicking participant from stage');

    deleteVideos();

    if (!stage) {
      console.error('handleVpUpdate: No Stage');

      return;
    }

    StageFactory.destroyStages();
    stage = undefined;

    sendVpLeftStage();
  }
}

function initializeWebSocket() {
  try {
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

      // Send ready message when page loads and is ready to join a stage
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

// Make functions available globally for debugging
(window as Record<string, unknown>).sendVpStatusUpdate = sendVpStatusUpdate;
(window as Record<string, unknown>).sendVpJoinedStage = sendVpJoinedStage;
(window as Record<string, unknown>).sendVpLeftStage = sendVpLeftStage;
(window as Record<string, unknown>).sendVpError = sendVpError;

// Periodically notify pptr of the current local publishers
(async function sendHeartbeat() {
  await window.heartbeat(StageFactory.localPublishers);
  setTimeout(sendHeartbeat, 10_000);
})();
