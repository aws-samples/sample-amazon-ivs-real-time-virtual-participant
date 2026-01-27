export const stopMediaStream = (stream: MediaStream) => {
  stream.getTracks().forEach((track) => track.stop());
};
