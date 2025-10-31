/// <reference types="vite/client" />

declare global {
  interface Window {
    VideoFrame: VideoFrame;
    MediaStreamTrackProcessor: MediaStreamTrackProcessor;
    shutdown: (reason: string) => Promise<void>;
    heartbeat: (publishers: string[]) => Promise<void>;
    getTokens: () => Promise<string[]>;
  }

  interface MediaStream {
    getTracks(): MediaStreamTrack[];
    getAudioTracks(): MediaStreamTrack[];
    getVideoTracks(): MediaStreamTrack[];
    addTrack(track: MediaStreamTrack): void;
    removeTrack(track: MediaStreamTrack): void;
    clone(): MediaStream;
    readonly id: string;
    readonly active: boolean;
  }

  interface VideoFrame {
    readonly timestamp: number;
    close(): void;
  }

  interface MediaStreamTrackProcessor {
    readonly readable: ReadableStream<VideoFrame>;
  }

  // https:// developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor
  const MediaStreamTrackProcessor: {
    prototype: MediaStreamTrackProcessor;

    new (init: {
      track: MediaStreamTrack;
      maxBufferSize?: number;
    }): MediaStreamTrackProcessor;
  };

  interface HTMLMediaElement {
    // https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream
    captureStream(): MediaStream;
  }
}

export {};
