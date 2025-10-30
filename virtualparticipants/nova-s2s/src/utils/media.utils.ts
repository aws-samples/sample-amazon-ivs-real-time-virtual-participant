function stopMediaStream(mediaStream?: MediaStream) {
  if (!mediaStream) return;

  // Clear any drawing intervals attached to the stream (for blank video streams)
  const streamWithInterval = mediaStream as MediaStream & {
    __drawIntervalId?: NodeJS.Timeout;
  };
  if (streamWithInterval.__drawIntervalId) {
    clearInterval(streamWithInterval.__drawIntervalId);
    delete streamWithInterval.__drawIntervalId;
  }

  // Stop all tracks
  const tracks = mediaStream.getTracks();
  tracks.forEach((track) => track.stop());
}

export { stopMediaStream };
