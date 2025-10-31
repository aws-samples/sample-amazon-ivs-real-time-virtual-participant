import {
  LocalStageStream,
  StageAudioConfiguration,
  StageError,
  StageErrorCategory,
  StageEvents,
  StageParticipantInfo,
  StageParticipantPublishState,
  StageVideoConfiguration,
  SubscribeType
} from 'amazon-ivs-web-broadcast';

import type Stage from './Stage';
import { StrategyMutators } from './types';

const { STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED, ERROR: STAGE_ERROR } =
  StageEvents;

const STAGE_MAX_BITRATE = 2500;
const STAGE_MAX_FRAMERATE = 30;
const STAGE_MAX_AUDIO_BITRATE_KBPS = 128;

class StageStrategy {
  private shouldPublish = false;

  private mediaStreamToPublish?: MediaStream;

  /**
   * Stage Strategy
   */

  stageStreamsToPublish(): LocalStageStream[] {
    const streams: LocalStageStream[] = [];

    const audioTrack = this.mediaStreamToPublish?.getAudioTracks()[0];
    const audioConfig: StageAudioConfiguration = {
      stereo: true,
      maxAudioBitrateKbps: STAGE_MAX_AUDIO_BITRATE_KBPS
    };
    if (audioTrack) {
      streams.push(new LocalStageStream(audioTrack, audioConfig));
    }

    const videoTrack = this.mediaStreamToPublish?.getVideoTracks()[0];
    const videoConfig: StageVideoConfiguration = {
      simulcast: { enabled: false },
      maxVideoBitrateKbps: STAGE_MAX_BITRATE,
      maxFramerate: STAGE_MAX_FRAMERATE,
      inBandMessaging: {
        enabled: true
      }
    };

    if (videoTrack) {
      streams.push(new LocalStageStream(videoTrack, videoConfig));
    }

    return streams;
  }

  shouldPublishParticipant(): boolean {
    return this.shouldPublish;
  }

  shouldSubscribeToParticipant(_: StageParticipantInfo): SubscribeType {
    return SubscribeType.NONE;
  }

  /**
   * Stage Strategy mutators
   */

  mutators(stage: Stage): StrategyMutators {
    /**
     * Calling 'mutators' with a Stage instance should replace that Stage's
     * strategy with the one for which the mutators will be generated.
     */
    stage.replaceStrategy(this);

    return {
      publish: this.publishMutator(stage),
      unpublish: this.unpublishMutator(stage),
      republish: this.republishMutator(stage),
      updateStreamsToPublish: this.updateStreamsMutator(stage)
    };
  }

  private publishMutator(stage: Stage) {
    /**
     * Invoking the `publish` method can optionally serve a dual purpose:
     *
     * 1. Sets the value of `shouldPublish` to `true` to attempt publishing
     *
     * 2. Optional: if `mediaStreamToPublish` is provided, then the streams
     *    to publish are updated as part of the same strategy refresh
     *
     * As such, `publish` can be invoked to seamlessly update an already published stream,
     * or to start publishing with a new or previously published stream, if one exists.
     * This is especially useful with publishing display/screen-share streams.
     */
    return (mediaStreamToPublish?: MediaStream) => {
      if (mediaStreamToPublish) {
        this.mediaStreamToPublish = mediaStreamToPublish;
      }

      this.shouldPublish = true;
      stage.refreshStrategy();
    };
  }

  private unpublishMutator(stage: Stage) {
    return () => {
      /**
       * Only update `shouldPublish` and leave `mediaStreamToPublish` as is
       * to allow for the currently media stream to be re-published later.
       */
      this.shouldPublish = false;
      stage.refreshStrategy();
    };
  }

  private republishMutator(stage: Stage) {
    const publish = this.publishMutator(stage);
    const unpublish = this.unpublishMutator(stage);

    return () =>
      /**
       * Temporary event listeners are registered to re-publish the
       * local participant stream only when we receive confirmation
       * that the stream has been unpublished.
       */
      new Promise<void>((resolve, reject) => {
        let publishTimeout: NodeJS.Timeout;

        function onPublishChange(
          _: StageParticipantInfo,
          state: StageParticipantPublishState
        ) {
          if (state === StageParticipantPublishState.NOT_PUBLISHED) {
            // Delay publishing to avoid race conditions
            publishTimeout = setTimeout(publish, 400);
          }

          if (state === StageParticipantPublishState.PUBLISHED) {
            resolve();
            finishRepublish();
          }
        }

        function onStageError(error: StageError) {
          if (error.category === StageErrorCategory.PUBLISH_ERROR) {
            reject(new Error('Failed to re-publish!', { cause: error }));
            finishRepublish();
          }
        }

        function finishRepublish() {
          clearTimeout(publishTimeout);
          stage.off(STAGE_ERROR, onStageError);
          stage.off(STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED, onPublishChange);
        }

        if (this.shouldPublish) {
          stage.on(STAGE_ERROR, onStageError);
          stage.on(STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED, onPublishChange);
          unpublish();
        } else resolve();
      });
  }

  private updateStreamsMutator(stage: Stage) {
    return (mediaStreamToPublish: MediaStream) => {
      this.mediaStreamToPublish = mediaStreamToPublish;
      stage.refreshStrategy();
    };
  }
}

export default StageStrategy;
