// Probe: waits for the real VRM scene, then runs one FULL Performance Lab measurement
// through the actual UI buttons (the same path a user takes).
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const findButton = (label) =>
    Array.from(document.querySelectorAll('button')).find(
      (button) => (button.textContent || '').trim() === label,
    );

  const readReadinessAlert = () => {
    const alert = document.querySelector('[role="alert"]');
    return alert ? alert.innerText.trim() : null;
  };

  const readMeasurement = () => {
    const heading = Array.from(document.querySelectorAll('h3')).find(
      (h) => (h.textContent || '').trim() === 'Last Measurement',
    );
    if (!heading) return null;
    const header = heading.closest('.panel-header') ?? heading.parentElement;
    const wrapper = header ? header.parentElement : null;
    const grid = wrapper ? wrapper.querySelector('.metrics-grid') : null;
    if (!grid) return null;
    const out = {};
    Array.from(grid.children).forEach((row) => {
      const key = row.querySelector('span')?.textContent?.trim();
      const value = row.querySelector('strong')?.textContent?.trim();
      if (key) out[key] = value ?? null;
    });
    return out;
  };

  // 1. Wait until the live VRM scene is actually rendering.
  const readyStart = performance.now();
  let diag = window.__avatarDiagnostics;
  while (performance.now() - readyStart < 90000) {
    diag = window.__avatarDiagnostics;
    const overlayGone = document.querySelector('.avatar-overlay') === null;
    if (diag && diag.vrmProcessed && diag.rendererActive && overlayGone) break;
    await sleep(250);
  }
  const readyMs = Math.round(performance.now() - readyStart);

  // 2. Enable the Performance Lab through its real toggle.
  const toggle = findButton('Performance Lab OFF');
  if (toggle) {
    toggle.click();
    await sleep(1000);
  }

  // 3. Run ONE full measurement.
  const measureButton = findButton('Measure Current Test');
  const measurementStarted = Boolean(measureButton);
  if (measureButton) measureButton.click();

  // 4. Wait for the measurement panel to populate (warmup + 5s window).
  const measureStart = performance.now();
  let measurement = null;
  while (performance.now() - measureStart < 30000) {
    measurement = readMeasurement();
    if (measurement) break;
    await sleep(400);
  }

  return {
    readyMs,
    measurementMs: Math.round(performance.now() - measureStart),
    diagnostics: diag,
    labEnabled: Boolean(findButton('Performance Lab ON')),
    measurementStarted,
    measurement,
    readinessAlert: readReadinessAlert(),
    avatarReady: diag ? diag.rendererActive && diag.visible && diag.avatarInScene : false,
    labSnapshot: window.__performanceLab ? window.__performanceLab.getLatestSnapshot() : null,
  };
})();
