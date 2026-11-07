import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const OUTPUT_PATH = path.resolve('probe-raf-production-diagnosis.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const udir = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-diag-'));
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9345;
const TARGET_URL = 'http://localhost:4173/';

console.log(`[Diagnostic] Launching Chrome against ${TARGET_URL} on CDP port ${CDP_PORT}...`);

const proc = spawn(CHROME_PATH, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${udir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,900',
  TARGET_URL,
]);

let killed = false;
function cleanup() {
  if (killed) return;
  killed = true;
  try { proc.kill(); } catch {}
  setTimeout(() => {
    try { fs.rmSync(udir, { recursive: true, force: true }); } catch {}
  }, 1000);
}
process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

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
    } catch {}
  }
}

async function getTabs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const tabs = await res.json();
      if (tabs.length > 0) return tabs;
    } catch {}
    await sleep(500);
  }
  throw new Error('Timed out waiting for Chrome tabs to appear on CDP port');
}

async function runDiagnostic() {
  const tabs = await getTabs();
  console.log(`[Diagnostic] Discovered ${tabs.length} tabs.`);

  // Find the page tab for localhost:4173
  const pageTab = tabs.find((t) => t.type === 'page' && t.url?.includes('localhost:4173')) || tabs.find((t) => t.type === 'page') || tabs[0];
  console.log(`[Diagnostic] Connecting to target tab: ${pageTab.title || 'untitled'} (${pageTab.url})...`);

  const session = await CdpSession.connect(pageTab.webSocketDebuggerUrl);

  // Enable Page & Runtime
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Page.bringToFront');

  // Query GPU system info via CDP
  let gpuSystemInfo = null;
  try {
    gpuSystemInfo = await session.send('Gpu.getSystemInfo');
  } catch (err) {
    console.warn('[Diagnostic] Could not fetch Gpu.getSystemInfo:', err.message);
  }

  // Wait for avatar readiness in the app
  console.log('[Diagnostic] Waiting for avatar readiness via window.__performanceLab...');
  let avatarReady = false;
  for (let i = 0; i < 60; i++) {
    avatarReady = await session.evaluate(`(() => {
      const lab = window.__performanceLab;
      if (lab && typeof lab.isAvatarSceneReady === 'function') {
        return lab.isAvatarSceneReady();
      }
      return false;
    })()`);
    if (avatarReady) break;
    await sleep(500);
  }

  console.log(`[Diagnostic] Avatar readiness achieved: ${avatarReady}. Warmup for 2 seconds...`);
  await sleep(2000);

  // Bring to front and focus before measuring
  await session.send('Page.bringToFront');
  await session.evaluate(`window.focus()`);

  console.log('[Diagnostic] Starting 10-second RAF benchmark on production application page...');

  const appResult = await session.evaluate(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function getSchedulingState() {
      const canvas = document.querySelector('canvas');
      const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null;
      let unmaskedVendor = 'unavailable';
      let unmaskedRenderer = 'unavailable';
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          unmaskedVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || 'unknown';
          unmaskedRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'unknown';
        }
      }
      const lab = window.__performanceLab;
      const snapshot = lab?.getLatestSnapshot ? lab.getLatestSnapshot() : null;

      return {
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        canvasCss: canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : null,
        drawingBuffer: canvas ? { width: canvas.width, height: canvas.height } : null,
        webglVersion: gl ? (window.WebGL2RenderingContext && gl instanceof window.WebGL2RenderingContext ? 'WebGL2' : 'WebGL1') : 'none',
        unmaskedVendor,
        unmaskedRenderer,
        avatarReady: snapshot ? snapshot.avatarReady : (lab?.isAvatarSceneReady ? lab.isAvatarSceneReady() : false),
        avatarVisible: snapshot ? snapshot.avatarVisible : null,
        drawCalls: snapshot ? snapshot.drawCalls : null,
        triangles: snapshot ? snapshot.triangles : null,
      };
    }

    const stateBefore = getSchedulingState();

    // Listen for long tasks
    const longTasks = [];
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) {}

    // Record RAF timestamps for 10 seconds
    const TARGET_WINDOW_MS = 10000;
    const timestamps = [];
    const intervals = [];
    let lastTime = performance.now();
    let frameId = 0;
    const startTime = performance.now();

    await new Promise((resolve) => {
      const tick = (now) => {
        timestamps.push(now);
        intervals.push(now - lastTime);
        lastTime = now;
        if (now - startTime < TARGET_WINDOW_MS) {
          frameId = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      frameId = requestAnimationFrame(tick);
    });

    const endTime = performance.now();
    if (observer) {
      observer.disconnect();
    }

    const stateAfter = getSchedulingState();

    // Calculate long tasks clipped to measurement window
    const windowStart = startTime;
    const windowEnd = endTime;
    let clippedLongTaskDuration = 0;
    let clippedLongTaskCount = 0;
    let maxClippedLongTaskDuration = 0;

    for (const lt of longTasks) {
      const taskStart = lt.startTime;
      const taskEnd = lt.startTime + lt.duration;
      const overlapStart = Math.max(windowStart, taskStart);
      const overlapEnd = Math.min(windowEnd, taskEnd);
      if (overlapEnd > overlapStart) {
        const clippedDuration = overlapEnd - overlapStart;
        clippedLongTaskCount++;
        clippedLongTaskDuration += clippedDuration;
        if (clippedDuration > maxClippedLongTaskDuration) {
          maxClippedLongTaskDuration = clippedDuration;
        }
      }
    }

    // Interval statistics
    const count = intervals.length;
    const elapsedMs = endTime - startTime;
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / (count || 1);
    const sorted = [...intervals].sort((a, b) => a - b);
    const medianInterval = count > 0 ? sorted[Math.floor(count * 0.5)] : 0;
    const p95Interval = count > 0 ? sorted[Math.floor(count * 0.95)] : 0;
    const maxInterval = count > 0 ? sorted[count - 1] : 0;
    const minInterval = count > 0 ? sorted[0] : 0;
    const effectiveFps = elapsedMs > 0 && count > 1 ? ((count - 1) / (elapsedMs / 1000)) : 0;

    const intervalsOver50ms = intervals.filter((i) => i > 50).length;
    const intervalsOver100ms = intervals.filter((i) => i > 100).length;
    const intervalsOver500ms = intervals.filter((i) => i > 500).length;

    // Retrieve PerformanceLab metrics
    const lab = window.__performanceLab;
    const snapshot = lab?.getLatestSnapshot ? lab.getLatestSnapshot() : null;

    return {
      stateBefore,
      stateAfter,
      elapsedMs,
      callbackCount: count,
      effectiveFps,
      meanIntervalMs: meanInterval,
      medianIntervalMs: medianInterval,
      p95IntervalMs: p95Interval,
      minIntervalMs: minInterval,
      maxIntervalMs: maxInterval,
      intervalsOver50ms,
      intervalsOver100ms,
      intervalsOver500ms,
      firstFifteenIntervals: intervals.slice(0, 15),
      lastTenIntervals: intervals.slice(-10),
      longTasks: {
        observedCount: longTasks.length,
        clippedCount: clippedLongTaskCount,
        clippedTotalMs: clippedLongTaskDuration,
        clippedMaxMs: maxClippedLongTaskDuration,
      },
      performanceLabCpu: snapshot ? {
        updateMs: snapshot.updateMs,
        renderMs: snapshot.renderMs,
        unexplainedMs: snapshot.unexplainedMs,
        rawFrameMs: snapshot.rawFrameMs,
        rawFPS: snapshot.rawFPS,
        cpuBreakdown: snapshot.cpu,
        gpuTiming: snapshot.gpuTiming,
        gpuMs: snapshot.gpuMs,
        simulationDeltaMs: snapshot.simulationDeltaMs,
      } : null,
    };
  })()`);

  console.log('[Diagnostic] Application 10-second test completed.');
  console.log(`[Diagnostic] App Effective FPS: ${appResult.effectiveFps.toFixed(2)}, Callbacks: ${appResult.callbackCount}, Mean Interval: ${appResult.meanIntervalMs.toFixed(2)} ms`);

  // Now create an empty page control tab for baseline scheduling validation
  console.log('[Diagnostic] Running 10-second Control Test on empty page (about:blank)...');
  const targetCreated = await session.send('Target.createTarget', { url: 'about:blank' });
  const controlSession = await CdpSession.connect(
    `ws://127.0.0.1:${CDP_PORT}/devtools/page/${targetCreated.targetId}`
  );

  await controlSession.send('Page.enable');
  await controlSession.send('Runtime.enable');
  await controlSession.send('Page.bringToFront');
  await controlSession.evaluate('window.focus()');
  await sleep(1000);

  const controlResult = await controlSession.evaluate(`(async () => {
    function getSchedulingState() {
      return {
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      };
    }

    const stateBefore = getSchedulingState();

    const TARGET_WINDOW_MS = 10000;
    const intervals = [];
    let lastTime = performance.now();
    let frameId = 0;
    const startTime = performance.now();

    await new Promise((resolve) => {
      const tick = (now) => {
        intervals.push(now - lastTime);
        lastTime = now;
        if (now - startTime < TARGET_WINDOW_MS) {
          frameId = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      frameId = requestAnimationFrame(tick);
    });

    const endTime = performance.now();
    const stateAfter = getSchedulingState();

    const count = intervals.length;
    const elapsedMs = endTime - startTime;
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / (count || 1);
    const sorted = [...intervals].sort((a, b) => a - b);
    const medianInterval = count > 0 ? sorted[Math.floor(count * 0.5)] : 0;
    const p95Interval = count > 0 ? sorted[Math.floor(count * 0.95)] : 0;
    const maxInterval = count > 0 ? sorted[count - 1] : 0;
    const minInterval = count > 0 ? sorted[0] : 0;
    const effectiveFps = elapsedMs > 0 && count > 1 ? ((count - 1) / (elapsedMs / 1000)) : 0;

    const intervalsOver50ms = intervals.filter((i) => i > 50).length;
    const intervalsOver100ms = intervals.filter((i) => i > 100).length;
    const intervalsOver500ms = intervals.filter((i) => i > 500).length;

    return {
      stateBefore,
      stateAfter,
      elapsedMs,
      callbackCount: count,
      effectiveFps,
      meanIntervalMs: meanInterval,
      medianIntervalMs: medianInterval,
      p95IntervalMs: p95Interval,
      minIntervalMs: minInterval,
      maxIntervalMs: maxInterval,
      intervalsOver50ms,
      intervalsOver100ms,
      intervalsOver500ms,
      firstFifteenIntervals: intervals.slice(0, 15),
    };
  })()`);

  console.log('[Diagnostic] Empty Page Control Test completed.');
  console.log(`[Diagnostic] Control Effective FPS: ${controlResult.effectiveFps.toFixed(2)}, Callbacks: ${controlResult.callbackCount}, Mean Interval: ${controlResult.meanIntervalMs.toFixed(2)} ms`);

  // Close control tab
  controlSession.close();
  await session.send('Target.closeTarget', { targetId: targetCreated.targetId });

  session.close();

  // Determine hardware acceleration and rasterizer driver details
  const primaryGpu = gpuSystemInfo?.gpuInfo?.devices?.[0];
  const driverString = primaryGpu?.deviceString || appResult.stateBefore.unmaskedRenderer || 'Unknown';
  const isSoftwareWarp = /basic render driver|warp|swiftshader|llvmpipe/i.test(driverString);

  const finalReport = {
    testTimestamp: new Date().toISOString(),
    benchmarkTargetUrl: TARGET_URL,
    browserMode: 'Headed Chrome (Direct Desktop Window)',
    browserExecutable: CHROME_PATH,
    hardwareAcceleration: isSoftwareWarp
      ? 'UNAVAILABLE — Microsoft Basic Render Driver / WARP software rasterizer'
      : 'Hardware Accelerated',
    benchmarkValidityStatus: isSoftwareWarp
      ? 'NOT A VALID HARDWARE-ACCELERATED BENCHMARK (Constrained host environment: Sandy Bridge Intel HD 2000/3000 lacks D3D Feature Level 11_0, forcing ANGLE WARP CPU software rendering)'
      : 'VALID HARDWARE-ACCELERATED BENCHMARK',
    cdpGpuSystemInfo: gpuSystemInfo,
    applicationDiagnosis: {
      url: TARGET_URL,
      ...appResult,
    },
    emptyPageControl: {
      url: 'about:blank',
      ...controlResult,
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(finalReport, null, 2), 'utf8');
  console.log(`[Diagnostic] Comprehensive report saved to: ${OUTPUT_PATH}`);

  return finalReport;
}

runDiagnostic()
  .then((report) => {
    console.log('\n================ DIAGNOSTIC REPORT SUMMARY ================');
    console.log(JSON.stringify({
      benchmarkStatus: report.benchmarkValidityStatus,
      hardwareAcceleration: report.hardwareAcceleration,
      app: {
        effectiveFps: report.applicationDiagnosis.effectiveFps,
        callbackCount: report.applicationDiagnosis.callbackCount,
        elapsedMs: report.applicationDiagnosis.elapsedMs,
        meanIntervalMs: report.applicationDiagnosis.meanIntervalMs,
        medianIntervalMs: report.applicationDiagnosis.medianIntervalMs,
        p95IntervalMs: report.applicationDiagnosis.p95IntervalMs,
        maxIntervalMs: report.applicationDiagnosis.maxIntervalMs,
        intervalsOver50ms: report.applicationDiagnosis.intervalsOver50ms,
        intervalsOver100ms: report.applicationDiagnosis.intervalsOver100ms,
        intervalsOver500ms: report.applicationDiagnosis.intervalsOver500ms,
        performanceLabCpu: report.applicationDiagnosis.performanceLabCpu,
        longTasks: report.applicationDiagnosis.longTasks,
        visibilityStateBefore: report.applicationDiagnosis.stateBefore.visibilityState,
        hasFocusBefore: report.applicationDiagnosis.stateBefore.hasFocus,
        visibilityStateAfter: report.applicationDiagnosis.stateAfter.visibilityState,
        hasFocusAfter: report.applicationDiagnosis.stateAfter.hasFocus,
        unmaskedRenderer: report.applicationDiagnosis.stateBefore.unmaskedRenderer,
      },
      emptyPageControl: {
        effectiveFps: report.emptyPageControl.effectiveFps,
        callbackCount: report.emptyPageControl.callbackCount,
        meanIntervalMs: report.emptyPageControl.meanIntervalMs,
        medianIntervalMs: report.emptyPageControl.medianIntervalMs,
        p95IntervalMs: report.emptyPageControl.p95IntervalMs,
        maxIntervalMs: report.emptyPageControl.maxIntervalMs,
        intervalsOver50ms: report.emptyPageControl.intervalsOver50ms,
        intervalsOver100ms: report.emptyPageControl.intervalsOver100ms,
        intervalsOver500ms: report.emptyPageControl.intervalsOver500ms,
        hasFocus: report.emptyPageControl.stateBefore.hasFocus,
        visibility: report.emptyPageControl.stateBefore.visibilityState,
      }
    }, null, 2));
    console.log('===========================================================\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Diagnostic Fatal Error]:', err);
    process.exit(1);
  });
