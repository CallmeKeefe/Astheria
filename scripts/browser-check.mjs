/**
 * Development-only browser validation harness.
 *
 * Launches headless Chrome, drives it through the Chrome DevTools Protocol,
 * captures console output / page exceptions / failed network requests, then
 * evaluates a probe expression inside the page and prints a JSON report.
 *
 * Usage:
 *   node scripts/browser-check.mjs --url http://localhost:5181/ --seconds 40
 *
 * This file is a diagnostic tool only. It is never imported by the app.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const TARGET_URL = getArg('--url', 'http://localhost:5181/');
const RUN_SECONDS = Number(getArg('--seconds', '40'));
const CDP_PORT = Number(getArg('--cdp-port', '9333'));
const REPORT_PATH = getArg('--report', 'browser-check-report.json');
const PROBE = getArg('--probe', '');
const PROBE_FILE = getArg('--probe-file', '');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('No Chrome/Edge executable found.');
}

async function fetchJson(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error(`WebSocket failed: ${wsUrl}`)), { once: true });
    });
    return new CdpSession(socket);
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 120000);
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // ignore
    }
  }
}

const consoleMessages = [];
const pageExceptions = [];
const failedRequests = [];
const assetRequests = [];

const DEFAULT_PROBE = `(() => {
  const canvas = document.querySelector('canvas');
  let webglContext = 'none';
  if (canvas) {
    try { webglContext = canvas.getContext('webgl2') ? 'webgl2' : (canvas.getContext('webgl') ? 'webgl' : 'none'); }
    catch (error) { webglContext = 'error:' + error.message; }
  }
  return {
    readyState: document.readyState,
    canvasPresent: !!canvas,
    canvasClient: canvas ? canvas.clientWidth + 'x' + canvas.clientHeight : null,
    canvasBuffer: canvas ? canvas.width + 'x' + canvas.height : null,
    webglContext,
    overlayText: document.querySelector('.avatar-overlay') ? document.querySelector('.avatar-overlay').innerText.trim() : null,
    diagnostics: window.__avatarDiagnostics ?? null,
  };
})()`;

async function main() {
  const browserPath = findBrowser();
  const userDataDir = path.join(os.tmpdir(), `animetutor-cdp-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const headed = argv.includes('--headed');
  const cdpEndpoint = getArg('--cdp-endpoint', '');
  const cdpPort = Number(getArg('--cdp-port', cdpEndpoint ? new URL(cdpEndpoint).port || '9333' : '9333'));

  let isConnectedToExisting = false;
  try {
    const existingVersion = await fetchJson(`http://127.0.0.1:${cdpPort}/json/version`, 1000);
    if (existingVersion && existingVersion.Browser) {
      isConnectedToExisting = true;
    }
  } catch {
    isConnectedToExisting = false;
  }

  let browser = null;
  if (!isConnectedToExisting) {
    const flags = [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--enable-gpu-rasterization',
      '--window-size=1280,900',
      '--autoplay-policy=no-user-gesture-required',
    ];
    if (!headed) flags.unshift('--headless=new');

    browser = spawn(browserPath, [...flags, 'about:blank'], { stdio: 'ignore' });
  }

  let session;
  try {
    let targets = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
        if (targets.some((target) => target.type === 'page')) break;
      } catch {
        // browser not ready yet
      }
      await sleep(500);
    }

    const pageTarget = targets.find((target) => target.type === 'page');
    if (!pageTarget) throw new Error('No page target exposed by Chrome.');

    session = await CdpSession.connect(pageTarget.webSocketDebuggerUrl);

    session.onMessage((message) => {
      if (message.method === 'Runtime.consoleAPICalled') {
        const { type, args } = message.params;
        consoleMessages.push({
          type,
          text: args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '),
        });
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        pageExceptions.push(details.exception?.description ?? details.text ?? 'Unknown exception');
      } else if (message.method === 'Log.entryAdded') {
        const entry = message.params.entry;
        if (entry.level === 'error') {
          consoleMessages.push({ type: 'log-error', text: `${entry.text} ${entry.url ?? ''}`.trim() });
        }
      } else if (message.method === 'Network.responseReceived') {
        const { response } = message.params;
        if (response.url.includes('avatar.vrm')) {
          assetRequests.push({ url: response.url, status: response.status, mimeType: response.mimeType });
        }
      } else if (message.method === 'Network.loadingFailed') {
        failedRequests.push({ errorText: message.params.errorText });
      }
    });

    await session.send('Runtime.enable');
    await session.send('Log.enable');
    await session.send('Page.enable');
    await session.send('Network.enable');
    await session.send('Page.navigate', { url: TARGET_URL });

    await sleep(RUN_SECONDS * 1000);

    const probeExpression = PROBE_FILE
      ? fs.readFileSync(PROBE_FILE, 'utf8')
      : PROBE || DEFAULT_PROBE;

    const probeResult = await session.send('Runtime.evaluate', {
      expression: probeExpression,
      returnByValue: true,
      awaitPromise: true,
    });

    const report = {
      targetUrl: TARGET_URL,
      probe: probeResult.result?.value ?? null,
      consoleMessages,
      pageExceptions,
      failedRequests,
      assetRequests,
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    session?.close();
    if (browser) {
      browser.kill();
      await sleep(500);
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

main().catch((error) => {
  console.error('[browser-check] failed:', error);
  process.exitCode = 1;
});
