import { execSync } from 'node:child_process';

import {
  metricScope as _metricScope,
  Unit as _Unit
} from 'aws-embedded-metrics';
import puppeteer, { PuppeteerLaunchOptions } from 'puppeteer-core';

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
    '--proxy-bypass-list=*'
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

    ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((event) => {
      process.on(event, async () => {
        await page.close({ runBeforeUnload: true });
        await sleep(2000);
        await page.browser().close();
      });
    });

    return page.goto('http://localhost', { waitUntil: 'networkidle2' });
  })
  .catch((error) => shutdown(error.toString()));
