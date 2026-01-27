export const queueMacrotask = (callback: () => void) => {
  setTimeout(callback, 0);
};
