import { queueMacrotask } from '@utils/common.utils';
import {
  Stage,
  StageConnectionState,
  StageErrorCode,
  StageEvents,
  StageLeftReason,
  StageParticipantPublishState
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
  STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED
} = StageEvents;
const { CONNECTED } = StageConnectionState;
const { PUBLISHED } = StageParticipantPublishState;

class VpStage extends Stage {
  readonly strategyMutators: StrategyMutators;

  readonly participantId: string;

  readonly sei: SEI;

  socket: WebSocket | null;

  connected = false; // Indicates whether the local participant is currently CONNECTED

  publishing = false; // Indicates whether the local participant is currently PUBLISHED

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
}

export default VpStage;
