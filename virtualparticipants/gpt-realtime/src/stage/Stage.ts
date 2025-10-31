import { queueMacrotask } from '@utils/common.utils';
import { stopMediaStream } from '@utils/media.utils';
import {
  realtimeAIIntegration,
  TranscriptSEIMessage
} from '@utils/realtime-ai-integration';
import {
  Stage,
  StageConnectionState,
  StageErrorCode,
  StageEvents,
  StageLeftReason,
  StageParticipantPublishState,
  StreamType
} from 'amazon-ivs-web-broadcast';
import { jwtDecode } from 'jwt-decode';

import SEI from './SEI';
import StageStrategy from './StageStrategy';
import { StrategyMutators, TokenPayload } from './types';

const {
  ERROR: STAGE_ERROR,
  STAGE_CONNECTION_STATE_CHANGED,
  STAGE_LEFT,
  STAGE_PARTICIPANT_JOINED,
  STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED,
  STAGE_PARTICIPANT_STREAMS_ADDED,
  STAGE_PARTICIPANT_STREAMS_REMOVED
} = StageEvents;
const { CONNECTED } = StageConnectionState;
const { PUBLISHED } = StageParticipantPublishState;

class DealerStage extends Stage {
  readonly strategyMutators: StrategyMutators;

  readonly participantId: string;

  readonly sei: SEI;

  socket: WebSocket | null;

  connected = false; // Indicates whether the local participant is currently CONNECTED

  publishing = false; // Indicates whether the local participant is currently PUBLISHED

  remoteParticipantAudioElements = new Map<string, HTMLAudioElement>(); // Track audio elements by participant ID

  constructor(token: string, socket: WebSocket | null) {
    const strategy = new StageStrategy();
    super(token, strategy);

    const { jti, user_id: userId } = jwtDecode<TokenPayload>(token);
    this.strategyMutators = strategy.mutators(this);
    this.participantId = jti;
    this.sei = new SEI(this);

    /**
     * Ensure we leave the Stage when the window, the document and its resources are about to be unloaded,
     * i.e., when the user refreshes the page, closes the tab or closes the browser window.
     */
    const onBeforeUnload = () => queueMacrotask(this.leave);
    window.addEventListener('online', this.refreshStrategy, true);
    window.addEventListener('beforeunload', onBeforeUnload, true);

    // Set up SEI transcript sender for Realtime AI integration
    this.setupSEITranscriptSender();

    this.on(STAGE_PARTICIPANT_JOINED, (participant) => {
      if (participant.isLocal) {
        console.info(
          `[${userId}/${STAGE_PARTICIPANT_JOINED}]`,
          JSON.stringify(participant)
        );
      }
    });

    this.on(STAGE_CONNECTION_STATE_CHANGED, (state) => {
      console.info(`[${userId}/${STAGE_CONNECTION_STATE_CHANGED}]`, state);
      this.connected = state === CONNECTED;
    });

    this.on(STAGE_PARTICIPANT_STREAMS_ADDED, (participantInfo, streams) => {
      // If it is a remote participant
      if (!participantInfo.isLocal) {
        console.info(
          `[${userId}] Adding streams for remote participant: ${participantInfo.id}`
        );

        const audioStream = streams.find(
          (st) => st.streamType === StreamType.AUDIO
        );
        if (!audioStream) return;

        // Create audio element and pipe participant audio to it
        const audioElement = document.createElement('audio');
        audioElement.srcObject = new MediaStream();
        audioElement.autoplay = true;
        audioElement.muted = false;
        audioElement.id = `remote-audio-${participantInfo.id}`;

        audioElement.srcObject.addTrack(audioStream.mediaStreamTrack);

        document.body.appendChild(audioElement);
        audioElement.controls = true;
        audioElement.play();

        // Store reference for cleanup
        this.remoteParticipantAudioElements.set(
          participantInfo.id,
          audioElement
        );

        // Add audio input to Realtime AI integration for processing
        realtimeAIIntegration
          .addAudioInput(participantInfo.id, audioElement)
          .catch((error) => {
            console.error(
              `Failed to add audio input for participant ${participantInfo.id}:`,
              error
            );
          });
      }
    });

    this.on(STAGE_PARTICIPANT_STREAMS_REMOVED, (participantInfo, _streams) => {
      // If it is a remote participant
      if (!participantInfo.isLocal) {
        console.info(
          `[${userId}] Removing streams for remote participant: ${participantInfo.id}`
        );

        // Remove audio input from Realtime AI integration
        realtimeAIIntegration.removeAudioInput(participantInfo.id);

        const audioElement = this.remoteParticipantAudioElements.get(
          participantInfo.id
        );
        if (audioElement) {
          // Stop and cleanup the MediaStream
          if (audioElement.srcObject) {
            stopMediaStream(audioElement.srcObject as MediaStream);
            audioElement.srcObject = null;
          }

          // Remove audio element from DOM if it was added
          if (audioElement.parentNode) {
            audioElement.parentNode.removeChild(audioElement);
          }

          // Remove from our tracking map
          this.remoteParticipantAudioElements.delete(participantInfo.id);

          console.info(
            `[${userId}] Cleaned up audio element for participant: ${participantInfo.id}`
          );
        }
      }
    });

    this.on(
      STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED,
      (participantInfo, state) => {
        console.info(
          `[${userId}/${STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED}]`,
          state
        );

        if (participantInfo.isLocal) {
          this.publishing = state === PUBLISHED;

          if (this.publishing) {
            socket?.send(
              JSON.stringify({
                type: 'vp.joined_stage'
              })
            );
          }
        }
      }
    );

    this.on(STAGE_LEFT, async (reason) => {
      console.info(`[${userId}/${STAGE_LEFT}]`, reason);

      this.connected = false;
      this.publishing = false;
      window.removeEventListener('online', this.refreshStrategy);
      window.removeEventListener('beforeunload', onBeforeUnload);

      if (reason === StageLeftReason.PARTICIPANT_DISCONNECTED) {
        await window.shutdown(
          `Participant "${userId}" disconnected: ${reason}`
        );
      }
    });

    this.on(STAGE_ERROR, async (error) => {
      console.error(`[${userId}/${STAGE_ERROR}]`, JSON.stringify(error));

      if (error.code === StageErrorCode.TOKEN_EXPIRED) {
        await window.shutdown(
          `Participant "${userId}" errored: ${error.message}`
        );
      }
    });
  }

  readonly on: Stage['on'] = super.on.bind(this);

  readonly off: Stage['off'] = super.off.bind(this);

  readonly join = async (mediaStreamToPublish?: MediaStream) => {
    await super.join();

    if (mediaStreamToPublish) {
      this.strategyMutators.publish(mediaStreamToPublish);
    }
  };

  /**
   * Set up SEI transcript sender for Realtime AI integration
   */
  private setupSEITranscriptSender(): void {
    const transcriptSender = async (
      message: TranscriptSEIMessage
    ): Promise<void> => {
      try {
        // Ensure we're connected and publishing before sending SEI
        if (!this.connected || !this.publishing) {
          console.warn(
            '[SEI Transcript] Stage not connected or not publishing, skipping SEI send'
          );

          return;
        }

        // Send transcript via SEI with repeat count for reliability
        const repeatCount = message.partial ? 3 : 8; // More repeats for complete transcripts
        await this.sei.sendSeiMessage(
          message as unknown as Record<string, unknown>,
          repeatCount
        );

        console.info(
          `[SEI Transcript] Successfully sent ${message.partial ? 'partial' : 'complete'} transcript via SEI`
        );
      } catch (error) {
        console.error(
          '[SEI Transcript] Failed to send transcript via SEI:',
          JSON.stringify(error)
        );
        throw error; // Re-throw so caller can also handle the error
      }
    };

    // Register the transcript sender with Realtime AI integration
    realtimeAIIntegration.setSEITranscriptSender(transcriptSender);
    console.info(
      '[SEI Transcript] SEI transcript sender configured for Realtime AI integration'
    );
  }
}

export default DealerStage;
