// import events from '@assets/events.json';
import TrackProcessor from '@processor';
import type { Stage } from '@stage';
import StageFactory from '@stage';
import { debounce } from '@utils/common.utils';
import { stopMediaStream } from '@utils/media.utils';

const streams = new Map<HTMLVideoElement, MediaStream>();

const syncAndLoop = debounce(
  async () => {
    await TrackProcessor.closeAll(); // stop running processors

    await Promise.all(
      [...streams.keys()].map(async (video) => {
        video.pause();
        video.currentTime = 0; // sync
        await video.play(); // loop
      })
    );
  },
  1000,
  true
);

function createVideo(src: string, stage: Stage) {
  const video = document.createElement('video');

  const startVideoProcessing = () => processVideo(video, stage);
  video.addEventListener('loadeddata', startVideoProcessing, true);
  video.addEventListener('seeked', startVideoProcessing, true);
  video.addEventListener('ended', syncAndLoop, true);

  video.autoplay = true;
  video.muted = false;
  video.src = src;

  console.info('Created video: ', video.src);
}

function deleteVideos() {
  // Get all video elements in the document
  const videos = Array.from(document.querySelectorAll('video'));

  videos.forEach((video) => {
    // Stop associated MediaStream if it exists
    const stream = streams.get(video);
    if (stream) {
      stopMediaStream(stream);
      streams.delete(video);
    }

    // Pause video and remove from DOM
    video.pause();
    video.remove();
  });

  // Clear the streams Map
  streams.clear();
}

async function processVideo(video: HTMLVideoElement, stage: Stage) {
  const nextStream = video.captureStream();
  const prevStream = streams.get(video);
  streams.set(video, nextStream);

  const videoTrack = nextStream.getVideoTracks()[0];
  await TrackProcessor.create(videoTrack, stage);

  if (StageFactory.active) {
    if (stage.connected) {
      stage.strategyMutators.updateStreamsToPublish(nextStream);
    } else await stage.join(nextStream);
  }

  stopMediaStream(prevStream);

  // await processFrames(0, stage);
}

// async function processFrames(index: number, stage: Stage) {
//   const frame = await TrackProcessor.getByStage(stage)?.nextFrame();

//   if (frame) {
//     const timeMs = Math.floor(frame.timestamp / 1000);
//     frame.close(); // Close the frame before processing events

//     const nextIndex = processEvents(timeMs, index, stage);
//     await processFrames(nextIndex, stage);
//   }
// }

// function processEvents(timeMs: number, index: number, stage: Stage) {
//   while (index < events.length - 1) {
//     const event = events[index];
//     const millis = toMillis(event.timestamp);

//     try {
//       if (timeMs >= millis) {
//         stage.sei.sendSeiMessage(event, 5);
//       } else break;
//     } catch (error) {
//       // SEI insertion failures should not interrupt frame/event processing
//       console.error(String(error));
//     }

//     index += 1;
//   }

//   return index;
// }

export { createVideo, deleteVideos };
