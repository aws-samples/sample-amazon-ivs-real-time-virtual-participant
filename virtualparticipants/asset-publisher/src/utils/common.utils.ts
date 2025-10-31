function queueMacrotask(task: (args: void) => void) {
  setTimeout(task, 0);
}

function cyclicIndex<T>(arr: T[], i: number) {
  const n = arr.length;

  return arr[((i % n) + n) % n];
}

function toMillis(timestamp: string) {
  const [h, m, s, ms] = timestamp.split(':').map(Number);

  if (isNaN(h) || isNaN(m) || isNaN(s) || isNaN(ms)) {
    throw new Error('Invalid timestamp format. Expected hh:mm:ss:ms');
  }

  return ms + s * 1000 + m * 60 * 1000 + h * 60 * 60 * 1000;
}

function debounce<F extends (...args: Parameters<F>) => ReturnType<F>>(
  callback: F,
  waitFor: number,
  leading = false
) {
  let timeout: NodeJS.Timeout | undefined;

  function debounced(...args: Parameters<F>) {
    if (leading && !timeout) {
      callback(...args);
    }

    clearTimeout(timeout);

    timeout = setTimeout(() => {
      timeout = undefined;

      if (!leading) {
        callback(...args);
      }
    }, waitFor);
  }

  function cancel() {
    clearTimeout(timeout);
    timeout = undefined;
  }

  debounced.cancel = cancel;

  return debounced;
}

export { cyclicIndex, debounce, queueMacrotask, toMillis };
