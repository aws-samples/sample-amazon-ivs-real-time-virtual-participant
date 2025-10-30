import { execSync } from 'node:child_process';

import { metricScope, Unit } from 'aws-embedded-metrics';
import puppeteer, { PuppeteerLaunchOptions } from 'puppeteer-core';

const UNRESPONSIVE_PUBLISHER_TIMEOUT = 90_000;
const publishersLastSeen = new Map<string, number>();

const launchOptions: PuppeteerLaunchOptions = {
  pipe: true,
  dumpio: true,
  headless: true,
  devtools: false,
  handleSIGHUP: false,
  handleSIGINT: false,
  handleSIGTERM: false,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  args: [
    '--incognito',
    '--no-pings',
    '--no-zygote',
    '--no-sandbox',
    '--no-first-run',
    '--no-experiments',
    '--disable-gpu',
    '--disable-zero-copy',
    '--disable-dev-tools',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
    '--disable-software-rasterizer',
    '--disable-site-isolation-trials',
    '--disable-accelerated-video-encode',
    '--disable-accelerated-video-decode',
    '--enable-features=NetworkService',
    '--autoplay-policy=no-user-gesture-required',
    '--renderer-process-limit=1',
    "--proxy-server='direct://'",
    '--proxy-bypass-list=*',
    // Audio configuration for container environment
    '--enable-logging',
    '--log-level=0',
    // PulseAudio configuration
    '--alsa-output-device=pulse',
    '--alsa-input-device=pulse'
  ]
};

function heartbeat(publishers: string[]) {
  log('[heartbeat]', JSON.stringify({ publishers }));
  if (publishers.length) {
    publishers.forEach((id) => publishersLastSeen.set(id, Date.now()));
  } else {
    publishersLastSeen.clear();
  }
}

function shutdown(reason: string) {
  log('[shutdown]', 'Subprocess shutdown initiated!', reason);
  execSync(`supervisorctl -c ${process.env.SUPERVISOR_CONF_PATH} shutdown`);
}

function getTokens() {
  return process.env.PARTICIPANT_TOKENS?.split(',') ?? [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(...args: unknown[]) {
  console.info(new Date().toISOString(), ...args);
}

// Periodically sends a metric containing the count of unresponsive publishers
const monitorUnresponsivePublishers = metricScope((metrics) => {
  metrics.setDimensions({ DealerId: process.env.DEALER_ID! });

  return async function monitor() {
    let unresponsivePublishers = 0;

    publishersLastSeen.forEach((lastSeen, participantId) => {
      const timeSinceLastSeen = Date.now() - lastSeen;
      const firstDetected = new Date(lastSeen).toISOString();

      metrics.setProperty(
        `${participantId}.TimeSinceLastSeen`,
        timeSinceLastSeen
      );

      if (timeSinceLastSeen > UNRESPONSIVE_PUBLISHER_TIMEOUT) {
        unresponsivePublishers += 1;
        log(
          `Unresponsive publisher ${participantId} was last seen ${timeSinceLastSeen}ms ago. First detected: ${firstDetected}.`
        );

        // TODO: Remove or improve shutdown after verifying CPU scaling issue
        // shutdown('Restarting to prevent CPU frequency scaling.');
      }
    });

    await metrics
      .putMetric(
        'UnresponsiveDealerPublishers',
        unresponsivePublishers,
        Unit.Count
      )
      .flush();

    setTimeout(monitor, 5000);
  };
});

puppeteer
  .launch(launchOptions)
  .then((browser) => browser.newPage())
  .then((page) => {
    page.exposeFunction('shutdown', shutdown);
    page.exposeFunction('heartbeat', heartbeat);
    page.exposeFunction('getTokens', getTokens);

    page.on('console', (msg) => {
      log(msg.type().toUpperCase(), msg.text());
    });

    page.on('domcontentloaded', () => {
      // Monitor unresponsive publishers if we're running inside ECS
      if (process.env.ECS_CONTAINER_METADATA_URI) {
        /**
         * Delay monitoring to maintain the current alarm state
         * when the task is restarted until we have sufficient
         * information about the responsiveness of publishers.
         */
        setTimeout(
          monitorUnresponsivePublishers,
          UNRESPONSIVE_PUBLISHER_TIMEOUT
        );
      }
    });

    ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((event) => {
      process.on(event, async () => {
        await page.close({ runBeforeUnload: true });
        await sleep(2000);
        await page.browser().close();
      });
    });

    // Get token from environment variable if set
    const tokens = getTokens();
    const url =
      tokens.length > 0
        ? `http://localhost?token=${encodeURIComponent(tokens[0])}`
        : 'http://localhost';

    log('[page.goto]', `Navigating to: ${url}`);

    return page.goto(url, { waitUntil: 'networkidle2' });
  })
  .catch((error) => shutdown(error.toString()));
