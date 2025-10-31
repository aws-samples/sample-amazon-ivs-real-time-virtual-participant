// import events from '@assets/events.json';
// import TrackProcessor from '@processor';
import type { Stage } from '@stage';
import StageFactory from '@stage';
import { stopMediaStream } from '@utils/media.utils';

const streams = new Map<HTMLVideoElement | HTMLAudioElement, MediaStream>();

interface AudioParticipantConfig {
  onStreamReady?: (stream: MediaStream) => void;
  onError?: (error: Error) => void;
}

/**
 * Creates a blank (black) video stream for SEI message transport
 * Uses minimal resources with low resolution and framerate
 * Continuously draws to canvas to ensure video frames are published
 */
function createBlankVideoStream(): MediaStream {
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
  // This is critical in headless environments like Docker
  const intervalId = setInterval(drawFrame, 1000 / 15); // 15 fps = ~67ms

  // Store interval ID on the stream for potential cleanup
  (
    stream as MediaStream & { __drawIntervalId?: NodeJS.Timeout }
  ).__drawIntervalId = intervalId;

  console.info(
    '[createBlankVideoStream] Created blank video stream with continuous drawing',
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

function createAudioParticipant(
  stage: Stage,
  config: AudioParticipantConfig = {}
) {
  // Create audio element for AI output
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.id = 'ai-output-audio';
  document.body.appendChild(audio);

  console.info('[createAudioParticipant] Created AI output audio element');

  // Don't start capturing immediately - wait for proper initialization
  // Return both the element and a function to start capture when ready
  return {
    element: audio,
    startCapture: () => processAudio(audio, stage, config)
  };
}

async function processAudio(
  audio: HTMLAudioElement,
  stage: Stage,
  config: AudioParticipantConfig = {}
) {
  const startTime = Date.now();
  const maxRetries = 3;
  const retryDelayMs = 100;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.info(
        `[processAudio] Starting audio capture process (attempt ${attempt}/${maxRetries})`,
        {
          audioId: audio.id,
          hasSource: !!audio.srcObject,
          stageConnected: stage.connected,
          timestamp: new Date().toISOString()
        }
      );

      // Basic validation for audio element source
      if (!audio.srcObject) {
        const error = new Error(
          `Audio element has no source object - cannot capture stream (attempt ${attempt}/${maxRetries})`
        );
        console.error('[processAudio]', error.message, {
          audioId: audio.id,
          audioSrc: audio.src,
          audioCurrentSrc: audio.currentSrc,
          attempt,
          maxRetries
        });

        // If this is not the last attempt, wait briefly and retry
        if (attempt < maxRetries) {
          console.info(`[processAudio] Retrying in ${retryDelayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }

        // Last attempt failed, report error
        config.onError?.(error);

        return;
      }

      // Continue with processing if srcObject is available
      return await processAudioCapture(audio, stage, config, startTime);
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(
        `[processAudio] Error in attempt ${attempt}/${maxRetries}:`,
        error,
        {
          totalTime,
          audioId: audio.id,
          stageConnected: stage?.connected
        }
      );

      // If this is not the last attempt, wait briefly and retry
      if (attempt < maxRetries) {
        console.info(`[processAudio] Retrying in ${retryDelayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }

      // Last attempt failed, report error
      config.onError?.(
        error instanceof Error ? error : new Error(String(error))
      );

      return;
    }
  }
}

async function processAudioCapture(
  audio: HTMLAudioElement,
  stage: Stage,
  config: AudioParticipantConfig,
  startTime: number
) {
  try {
    // Log audio element state for debugging
    console.info('[processAudioCapture] Audio element state:', {
      id: audio.id,
      readyState: audio.readyState,
      paused: audio.paused,
      muted: audio.muted,
      volume: audio.volume,
      currentTime: audio.currentTime,
      duration: audio.duration,
      srcObjectType: audio.srcObject?.constructor.name
    });

    // Wait a short delay to ensure audio is actually flowing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Capture audio stream from the audio element
    const audioStream = audio.captureStream();

    // Validate the captured audio stream has audio tracks
    const audioTracks = audioStream.getAudioTracks();
    if (audioTracks.length === 0) {
      const error = new Error('Captured stream has no audio tracks');
      console.error('[processAudioCapture]', error.message, {
        streamId: audioStream.id,
        streamActive: audioStream.active,
        totalTracks: audioStream.getTracks().length
      });
      config.onError?.(error);

      return;
    }

    // Log detailed audio track information
    audioTracks.forEach((track, index) => {
      console.info(
        `[processAudioCapture] Audio track ${index}:`,
        JSON.stringify({
          id: track.id,
          kind: track.kind,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings ? track.getSettings() : 'not supported',
          constraints: track.getConstraints
            ? track.getConstraints()
            : 'not supported'
        })
      );
    });

    // Create blank video stream for SEI message transport
    console.info(
      '[processAudioCapture] Creating blank video stream for SEI transport'
    );
    const blankVideoStream = createBlankVideoStream();
    const videoTracks = blankVideoStream.getVideoTracks();

    if (videoTracks.length === 0) {
      const error = new Error(
        'Failed to create video tracks for blank video stream'
      );
      console.error('[processAudioCapture]', JSON.stringify(error.message));
      config.onError?.(error);

      return;
    }

    // Log video track information
    videoTracks.forEach((track, index) => {
      console.info(
        `[processAudioCapture] Video track ${index}:`,
        JSON.stringify({
          id: track.id,
          kind: track.kind,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings ? track.getSettings() : 'not supported'
        })
      );
    });

    // Create combined stream with both audio and video tracks
    const combinedStream = new MediaStream();

    // Add audio tracks
    audioTracks.forEach((track) => combinedStream.addTrack(track));

    // Add video tracks
    videoTracks.forEach((track) => combinedStream.addTrack(track));

    console.info(
      '[processAudioCapture] Successfully created combined audio-video stream',
      JSON.stringify({
        combinedStreamId: combinedStream.id,
        audioStreamId: audioStream.id,
        videoStreamId: blankVideoStream.id,
        totalTracks: combinedStream.getTracks().length,
        audioTracks: combinedStream.getAudioTracks().length,
        videoTracks: combinedStream.getVideoTracks().length,
        streamActive: combinedStream.active,
        captureTime: Date.now() - startTime
      })
    );

    const prevStream = streams.get(audio);
    streams.set(audio, combinedStream);

    // Validate combined stream before publishing
    const isValid = validateCombinedStream(combinedStream);
    if (!isValid) {
      const error = new Error('Combined audio-video stream validation failed');
      console.error('[processAudioCapture]', error.message);
      config.onError?.(error);

      return;
    }

    // Notify that stream is ready
    config.onStreamReady?.(combinedStream);

    // Publish combined stream to the stage
    if (StageFactory.active) {
      const publishStartTime = Date.now();

      if (stage.connected) {
        console.info(
          '[processAudioCapture] Updating existing stage streams with combined audio-video stream'
        );
        stage.strategyMutators.updateStreamsToPublish(combinedStream);
      } else {
        console.info(
          '[processAudioCapture] Joining stage with combined audio-video stream'
        );
        await stage.join(combinedStream);
      }

      console.info(
        '[processAudioCapture] Stage publishing completed',
        JSON.stringify({
          publishTime: Date.now() - publishStartTime,
          wasConnected: stage.connected
        })
      );
    } else {
      console.warn(
        '[processAudioCapture] StageFactory not active - cannot publish stream'
      );
    }

    stopMediaStream(prevStream);

    const totalTime = Date.now() - startTime;
    console.info(
      '[processAudioCapture] Audio-video processing completed successfully',
      JSON.stringify({
        totalTime,
        streamId: combinedStream.id,
        totalTracks: combinedStream.getTracks().length,
        audioTracks: combinedStream.getAudioTracks().length,
        videoTracks: combinedStream.getVideoTracks().length
      })
    );
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(
      '[processAudioCapture] Failed to process audio-video:',
      error,
      JSON.stringify({
        totalTime,
        audioId: audio.id,
        stageConnected: stage?.connected
      })
    );
    config.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

function validateAudioStream(stream: MediaStream): boolean {
  const audioTracks = stream.getAudioTracks();

  if (audioTracks.length === 0) {
    console.warn('[validateAudioStream] No audio tracks in stream');

    return false;
  }

  // Check if tracks are actually receiving audio data
  for (const track of audioTracks) {
    if (track.readyState !== 'live') {
      console.warn(
        '[validateAudioStream] Audio track not in live state:',
        track.readyState
      );

      return false;
    }
  }

  console.info('[validateAudioStream] Audio stream validation passed');

  return true;
}

/**
 * Validates a combined audio-video stream for both audio and video tracks
 */
function validateCombinedStream(stream: MediaStream): boolean {
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();

  // Check audio tracks
  if (audioTracks.length === 0) {
    console.warn('[validateCombinedStream] No audio tracks in combined stream');

    return false;
  }

  // Check video tracks
  if (videoTracks.length === 0) {
    console.warn('[validateCombinedStream] No video tracks in combined stream');

    return false;
  }

  // Validate audio tracks are live
  for (const track of audioTracks) {
    if (track.readyState !== 'live') {
      console.warn(
        '[validateCombinedStream] Audio track not in live state:',
        track.readyState
      );

      return false;
    }
  }

  // Validate video tracks are live
  for (const track of videoTracks) {
    if (track.readyState !== 'live') {
      console.warn(
        '[validateCombinedStream] Video track not in live state:',
        track.readyState
      );

      return false;
    }
  }

  console.info(
    '[validateCombinedStream] Combined audio-video stream validation passed',
    {
      audioTracks: audioTracks.length,
      videoTracks: videoTracks.length,
      totalTracks: stream.getTracks().length
    }
  );

  return true;
}

function deleteAudioElems() {
  // Get all audio elements in the document
  const audios = Array.from(document.querySelectorAll('audio'));

  audios.forEach((audio) => {
    // Stop associated MediaStream if it exists
    const stream = streams.get(audio);
    if (stream) {
      stopMediaStream(stream);
      streams.delete(audio);
    }

    // Pause audio and remove from DOM
    audio.pause();
    audio.remove();
  });

  // Clear the streams Map
  streams.clear();
}

export {
  createAudioParticipant,
  createBlankVideoStream,
  deleteAudioElems,
  validateAudioStream,
  validateCombinedStream
};
