function stopMediaStream(mediaStream?: MediaStream) {
  const tracks = mediaStream?.getTracks() ?? [];
  tracks.forEach((track) => track.stop());
}

export { stopMediaStream };
