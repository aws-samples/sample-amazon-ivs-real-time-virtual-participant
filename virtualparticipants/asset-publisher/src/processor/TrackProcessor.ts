import { Stage } from 'amazon-ivs-web-broadcast';

class TrackProcessor {
  private static instances = new Map<Stage, TrackProcessor>();

  private processor: MediaStreamTrackProcessor;

  private reader: ReadableStreamDefaultReader<VideoFrame>;

  private track: MediaStreamTrack;

  private closed = true;

  private constructor(track: MediaStreamTrack, stage: Stage) {
    this.processor = new MediaStreamTrackProcessor({ track });
    this.reader = this.processor.readable.getReader();
    this.track = track;
    this.closed = false;

    // Update the `closed` stream state
    this.reader.closed.then(() => (this.closed = true)).catch((error) => error);

    TrackProcessor.instances.set(stage, this);
  }

  static async create(videoTrack: MediaStreamTrack, stage: Stage) {
    const instance = TrackProcessor.getByStage(stage);

    if (instance) {
      await instance.reader.cancel();
      TrackProcessor.instances.delete(stage);
    }

    return new TrackProcessor(videoTrack, stage);
  }

  static getByStage(stage: Stage) {
    return TrackProcessor.instances.get(stage);
  }

  static closeAll() {
    return Promise.all(
      [...TrackProcessor.instances.values()].map((tp) => tp.reader.cancel())
    );
  }

  async nextFrame() {
    const { done, value: frame } = await this.reader.read();
    const trackEnded = this.track.readyState === 'ended';

    if (done || trackEnded || this.closed) {
      frame?.close();
      await this.reader.cancel();

      return;
    }

    return frame;
  }
}

export default TrackProcessor;
