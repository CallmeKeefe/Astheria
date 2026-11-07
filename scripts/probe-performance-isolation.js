/**
 * Development-only browser measurement harness for the Performance Lab
 * isolation matrix on real desktop graphics / headed browsers.
 *
 * It does NOT build a fake scene. It:
 *   1. connects to an already-running headed Chrome instance over CDP OR
 *      launches an isolated headed Chrome instance with hardware acceleration enabled,
 *   2. queries Chrome GPU SystemInfo to verify hardware acceleration,
 *   3. waits until the avatar scene reports "Avatar READY",
 *   4. triggers real PerformanceLab tests programmatically with 3s warmup and 10s window,
 *   5. extracts raw JSON measurements from the render-loop sampler,
 *   6. prints formatted results and markdown tables.
 *
 * Usage:
 *   node scripts/probe-performance-isolation.js --headed
 *   node scripts/probe-performance-isolation.js --cdp-endpoint http://127.0.0.1:9335
 *   node scripts/probe-performance-isolation.js --cdp-port 9335
 *   node scripts/probe-performance-isolation.js --test FULL
 *   node scripts/probe-performance-isolation.js --url http://localhost:4173/ (preview / production)
 *
 * Diagnostic tool only - never imported by the app.
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
const CDP_ENDPOINT = getArg('--cdp-endpoint', '');
const CDP_PORT = Number(getArg('--cdp-port', CDP_ENDPOINT ? new URL(CDP_ENDPOINT).port || '9335' : '9335'));
const REPORT_PATH = getArg('--report', 'probe-performance-isolation.json');
const READY_TIMEOUT_MS = Number(getArg('--ready-timeout', '120000'));
const MEASURE_WINDOW_MS = Number(getArg('--window-ms', '10000'));
const HEADED = !argv.includes('--headless'); // Headed by default for desktop performance benchmarks!

// The 6 minimum core isolation tests required for Stage 5:
const CORE_TESTS = [
  'FULL',
  'NO_AVATAR',
  'EMPTY_SCENE',
  'SIMPLE_CUBE',
  'AVATAR_STATIC',
  'NO_SHADOWS',
];
const _EXTRA_TESTS = ['NO_LIGHTING', 'NO_ENVIRONMENT', 'SHADOW_DIAGNOSTIC', 'NO_UI'];

const SINGLE_TEST = getArg('--test', '');
const TESTS_ARG = getArg('--tests', '');
const TESTS = SINGLE_TEST
  ? [SINGLE_TEST]
  : TESTS_ARG
    ? TESTS_ARG.split(',').map((v) => v.trim()).filter(Boolean)
    : CORE_TESTS;

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
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result?.value ?? null;
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // ignore
    }
  }
}

const ENVIRONMENT_PROBE = `(() => {
  const lab = window.__performanceLab;
  if (!lab) return null;
  const snapshot = lab.getLatestSnapshot();
  const canvas = document.querySelector('canvas');
  const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null;
  let rendererString = 'GPU renderer identification unavailable';
  let vendorString = 'GPU vendor identification unavailable';
  try {
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      rendererString = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || rendererString);
      vendorString = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || vendorString);
    }
  } catch (error) {
    rendererString = 'GPU renderer identification unavailable';
  }
  return {
    userAgent: navigator.userAgent,
    webdriver: Boolean(navigator.webdriver),
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    qualityTier: snapshot.renderer ? snapshot.renderer.qualityTier : null,
    webglVersion: snapshot.renderer ? snapshot.renderer.webglVersion : (gl ? (canvas.getContext('webgl2') ? 'WebGL2' : 'WebGL1') : null),
    gpuInfo: snapshot.gpuInfo,
    gpuVendorViaCanvas: vendorString,
    gpuRendererViaCanvas: rendererString,
    gpuTiming: snapshot.gpuTiming,
    longTaskSupported: (typeof PerformanceObserver !== 'undefined')
      && Array.isArray(PerformanceObserver.supportedEntryTypes)
      && PerformanceObserver.supportedEntryTypes.includes('longtask'),
    dpr: snapshot.dpr,
    canvasCss: canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : null,
    drawingBuffer: canvas ? { width: canvas.width, height: canvas.height } : null,
    avatar: snapshot.avatar,
    readinessMessage: snapshot.readinessMessage,
  };
})()`;

const READY_PROBE = `(() => {
  const lab = window.__performanceLab;
  if (!lab) return { labPresent: false };
  const snapshot = lab.getLatestSnapshot();
  return {
    labPresent: true,
    ready: lab.isAvatarSceneReady(),
    readinessMessage: lab.getReadinessMessage(),
    avatarReady: snapshot.avatarReady,
    avatarLoaded: snapshot.avatarLoaded,
    avatarInScene: snapshot.avatarInScene,
    avatarVisible: snapshot.avatarVisible,
    rendererActive: snapshot.rendererActive,
    drawCalls: snapshot.drawCalls,
    triangles: snapshot.triangles,
  };
})()`;

function measureExpression(test, windowMs = 10000) {
  return `(async () => {
  const lab = window.__performanceLab;
  if (!lab) return { ok: false, error: 'window.__performanceLab missing' };
  try {
    const result = await lab.measure(${JSON.stringify(`probe:${test}`)}, ${JSON.stringify(test)}, ${windowMs});
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
})()`;
}

function classifyHardwareAcceleration(rendererString, cdpFeatureStatus) {
  if (!rendererString || rendererString === 'GPU renderer identification unavailable') return 'unknown';
  const lower = rendererString.toLowerCase();
  if (lower.includes('swiftshader')) {
    return 'unavailable (Google SwiftShader software rasterizer)';
  }
  if (lower.includes('basic render driver') || lower.includes('warp')) {
    return 'unavailable (Microsoft Basic Render Driver / WARP software rasterizer)';
  }
  if (lower.includes('llvmpipe') || lower.includes('software')) {
    return 'unavailable (software rasterizer)';
  }
  if (cdpFeatureStatus && cdpFeatureStatus.webgl === 'unavailable_software') {
    return 'unavailable_software (per chrome://gpu)';
  }
  return 'available';
}

function formatRow(test, measurement) {
  if (typeof measurement === 'string') return { test, status: measurement };
  if (!measurement) return { test, status: 'Not run' };
  return {
    test,
    rawFPS: measurement.rawFPS,
    rawFrameMs: measurement.rawFrameMs,
    simulationDeltaMs: measurement.simulationDeltaMs,
    updateMs: measurement.updateMs,
    renderCpuMs: measurement.renderMs,
    gpuMs: measurement.gpuMs,
    drawCalls: measurement.drawCalls,
    triangles: measurement.triangles,
    frameCount: measurement.frameCount,
    longTasks: measurement.longTasks,
    status: measurement.avatarReady ? 'OK' : 'OK (avatar hidden by test)',
  };
}

function printMarkdownTable(rows, benchmarkLabel) {
  const num = (value, digits = 2) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '-');
  console.log('');
  if (benchmarkLabel) {
    console.log(`### Benchmark Mode: ${benchmarkLabel}`);
  }
  console.log('| Test | Raw FPS | Raw Frame ms | Simulation ms | Update ms | Render CPU ms | GPU ms | Draws | Tris | Long Tasks | Status |');
  console.log('| :--- | ------: | -----------: | ------------: | --------: | ------------: | :----: | ----: | ---: | :--------- | :----- |');
  for (const row of rows) {
    if (row.rawFPS === undefined) {
      console.log(`| ${row.test} | - | - | - | - | - | - | - | - | - | ${row.status} |`);
      continue;
    }
    const longTasks = row.longTasks && row.longTasks.available
      ? `${row.longTasks.count} / ${row.longTasks.totalMs.toFixed(1)} ms / max ${row.longTasks.maxMs.toFixed(1)} ms`
      : 'Long-task API unavailable';
    const gpuCell = row.gpuMs === null ? 'GPU timer unavailable' : num(row.gpuMs, 2);
    console.log(
      `| ${row.test} | ${num(row.rawFPS, 2)} | ${num(row.rawFrameMs, 1)} | ${num(row.simulationDeltaMs, 1)} | ${num(row.updateMs, 2)} | ${num(row.renderCpuMs, 2)} | ${gpuCell} | ${row.drawCalls} | ${row.triangles} | ${longTasks} | ${row.status} |`,
    );
  }
}

async function main() {
  const cdpPort = CDP_PORT;
  let browser = null;
  let userDataDir = null;
  let isConnectedToExisting = false;

  // 1. Determine whether to connect to an existing CDP instance or spawn a new headed Chrome
  try {
    const existingVersion = await fetchJson(`http://127.0.0.1:${cdpPort}/json/version`, 1000);
    if (existingVersion && existingVersion.Browser) {
      isConnectedToExisting = true;
      console.log(`[probe] Connected to existing Chrome instance on port ${cdpPort}: ${existingVersion.Browser}`);
    }
  } catch {
    isConnectedToExisting = false;
  }

  if (!isConnectedToExisting) {
    const browserPath = findBrowser();
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-desktop-'));

    // Launch Chrome headed with hardware acceleration flags, NO SwiftShader overrides!
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
    if (!HEADED) {
      flags.unshift('--headless=new');
    }

    console.log(`[probe] Launching ${HEADED ? 'HEADED' : 'HEADLESS'} Chrome on port ${cdpPort}...`);
    browser = spawn(browserPath, [...flags, 'about:blank'], { stdio: 'ignore' });
  }

  let session;
  let browserSession = null;
  try {
    // Connect to CDP target list
    let targets = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json/list`);
        if (targets.some((target) => target.type === 'page')) break;
      } catch {
        // waiting for browser port
      }
      await sleep(500);
    }

    const versionData = await fetchJson(`http://127.0.0.1:${cdpPort}/json/version`);
    let cdpGpuInfo = null;
    if (versionData && versionData.webSocketDebuggerUrl) {
      try {
        browserSession = await CdpSession.connect(versionData.webSocketDebuggerUrl);
        const sysInfo = await browserSession.send('SystemInfo.getInfo');
        cdpGpuInfo = sysInfo?.gpu ?? null;
      } catch (err) {
        console.warn('[probe] SystemInfo.getInfo query error:', err.message);
      }
    }

    // Reuse existing tab if already opened at TARGET_URL; otherwise pick an open page tab or navigate
    let pageTarget = targets.find((t) => t.type === 'page' && t.url && t.url.startsWith(TARGET_URL.replace(/\/$/, '')));
    const needNavigate = !pageTarget;
    if (!pageTarget) {
      pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    }
    if (!pageTarget) throw new Error('No page target exposed by Chrome over CDP.');

    session = await CdpSession.connect(pageTarget.webSocketDebuggerUrl);

    const consoleMessages = [];
    const pageExceptions = [];
    session.onMessage((message) => {
      if (message.method === 'Runtime.consoleAPICalled') {
        const { type, args } = message.params;
        const text = args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
        consoleMessages.push({ type, text });
        if (/Avatar READY/i.test(text)) console.log(`[page] ${text}`);
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        pageExceptions.push(details.exception?.description ?? details.text ?? 'Unknown exception');
      }
    });

    await session.send('Runtime.enable');
    await session.send('Log.enable');
    await session.send('Page.enable');

    if (needNavigate || pageTarget.url === 'about:blank') {
      console.log(`[probe] Navigating to ${TARGET_URL}...`);
      await session.send('Page.navigate', { url: TARGET_URL });
    }

    // 1. Wait until live avatar scene reports READY
    let readiness = null;
    const readyStart = Date.now();
    while (Date.now() - readyStart < READY_TIMEOUT_MS) {
      try {
        readiness = await session.evaluate(READY_PROBE);
      } catch {
        readiness = null;
      }
      if (readiness && readiness.labPresent && readiness.ready) break;
      await sleep(500);
    }
    if (!readiness || !readiness.ready) {
      throw new Error(`Avatar never became ready within ${READY_TIMEOUT_MS} ms: ${JSON.stringify(readiness)}`);
    }
    console.log(`[probe] Avatar READY after ${((Date.now() - readyStart) / 1000).toFixed(1)}s`);

    // 2. Hardware acceleration and environment verification
    const environment = await session.evaluate(ENVIRONMENT_PROBE);
    const userAgent = environment?.userAgent ?? versionData?.['User-Agent'] ?? '';
    const isHeadless = userAgent.includes('Headless') || !HEADED;
    const browserMode = isHeadless ? 'Headless' : 'Headed';

    const rendererString = environment?.gpuInfo?.available
      ? environment.gpuInfo.renderer
      : (environment?.gpuRendererViaCanvas ?? 'GPU renderer identification unavailable');
    const vendorString = environment?.gpuInfo?.available
      ? environment.gpuInfo.vendor
      : (environment?.gpuVendorViaCanvas ?? 'GPU vendor identification unavailable');

    const hardwareAcceleration = classifyHardwareAcceleration(rendererString, cdpGpuInfo?.featureStatus);
    const isHardwareAccelerated = hardwareAcceleration === 'available';

    const benchmarkStatus = isHardwareAccelerated
      ? 'VALID HARDWARE-ACCELERATED BENCHMARK'
      : 'NOT A VALID HARDWARE-ACCELERATED BENCHMARK';

    console.log('');
    console.log(`=======================================================`);
    console.log(`Browser Mode: ${browserMode}`);
    console.log(`Hardware Acceleration Status: ${hardwareAcceleration}`);
    console.log(`Benchmark Classification: ${benchmarkStatus}`);
    console.log(`WebGL Version: ${environment?.webglVersion ?? 'Unknown'}`);
    console.log(`WebGL Vendor: ${vendorString}`);
    console.log(`WebGL Renderer: ${rendererString}`);
    console.log(`Canvas CSS: ${environment?.canvasCss?.width}x${environment?.canvasCss?.height}`);
    console.log(`Drawing Buffer: ${environment?.drawingBuffer?.width}x${environment?.drawingBuffer?.height}`);
    console.log(`DPR: ${environment?.dpr}`);
    console.log(`=======================================================`);
    console.log('');

    // 3. Run the requested isolation tests with 3s warm-up and 10s measurement window
    const results = {};
    const rows = [];
    for (const test of TESTS) {
      process.stdout.write(`[probe] ${test} (3s warm-up + ${MEASURE_WINDOW_MS / 1000}s measure) ... `);
      const started = Date.now();
      const outcome = await session.evaluate(measureExpression(test, MEASURE_WINDOW_MS));
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (outcome && outcome.ok) {
        results[test] = outcome.result;
        const m = outcome.result;
        console.log(`done in ${seconds}s (raw ${m.rawFrameMs.toFixed(1)} ms / ${m.rawFPS.toFixed(2)} fps / ${m.drawCalls} draws / ${m.triangles} tris)`);
      } else {
        const message = outcome ? outcome.error : 'no result';
        results[test] = `TEST FAILED: ${message}`;
        console.log(`FAILED in ${seconds}s: ${message}`);
      }
      rows.push(formatRow(test, results[test]));
    }

    // 4. Verify scene was restored to baseline
    const postCheck = await session.evaluate(READY_PROBE);
    const finalSnapshot = await session.evaluate(`(() => {
      const lab = window.__performanceLab;
      const s = lab.getLatestSnapshot();
      return {
        mode: lab.getCurrentMode(),
        status: lab.getStatusMessage(),
        drawCalls: s.drawCalls,
        triangles: s.triangles,
        avatarReady: s.avatarReady,
        shadowState: s.shadowState,
        longTasks: lab.getLongTaskStatus(),
        gpuTiming: lab.getGpuTimingStatus(),
      };
    })()`);

    const report = {
      targetUrl: TARGET_URL,
      browserMode,
      hardwareAcceleration,
      benchmarkStatus,
      isHardwareAccelerated,
      cdpGpuInfo,
      environment,
      readyBefore: readiness,
      readyAfter: postCheck,
      finalSnapshot,
      results,
      rows,
      pageExceptions,
      consoleTail: consoleMessages.slice(-40),
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    printMarkdownTable(rows, `${browserMode} — ${benchmarkStatus}`);
    console.log('');
    console.log(`[probe] Report written to ${REPORT_PATH}`);
  } finally {
    session?.close();
    browserSession?.close();
    if (browser) {
      browser.kill();
      await sleep(500);
    }
    if (userDataDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

main().catch((error) => {
  console.error('[probe-performance-isolation] failed:', error);
  process.exitCode = 1;
});
