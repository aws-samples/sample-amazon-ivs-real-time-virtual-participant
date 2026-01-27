import {
  LocalStageStream,
  StageParticipantInfo,
  StageVideoConfiguration,
  SubscribeType
} from 'amazon-ivs-web-broadcast';

import type Stage from './Stage';
import { StrategyMutators } from './types';

const STAGE_MAX_BITRATE = 2500;
const STAGE_MAX_FRAMERATE = 30;

class StageStrategy {
  private shouldPublish = false;

  private mediaStreamToPublish?: MediaStream;

  /**
   * Stage Strategy
   */

  stageStreamsToPublish(): LocalStageStream[] {
    const streams: LocalStageStream[] = [];

    // Note: Captioner doesn't publish audio, only subscribes to it
    // But we still need to publish a video stream for SEI messages

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
      console.info(
        '[stageStreamsToPublish] Publishing video track: ',
        videoTrack
      );
      streams.push(new LocalStageStream(videoTrack, videoConfig));
    }

    return streams;
  }

  shouldPublishParticipant(): boolean {
    return this.shouldPublish;
  }

  shouldSubscribeToParticipant(_: StageParticipantInfo): SubscribeType {
    return SubscribeType.AUDIO_ONLY;
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
      publish: this.publishMutator(stage)
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
     */
    return (mediaStreamToPublish?: MediaStream) => {
      if (mediaStreamToPublish) {
        this.mediaStreamToPublish = mediaStreamToPublish;
      }

      this.shouldPublish = true;
      stage.refreshStrategy();
    };
  }
}

export default StageStrategy;
