// Probe: proves the Performance Lab never shows a convincing reading before the VRM is live.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const readPanel = () => {
    const panel = document.querySelector('.performance-panel');
    if (!panel) return null;
    const text = panel.innerText;
    const rows = {};
    Array.from(panel.querySelectorAll('.metrics-grid > div')).forEach((row) => {
      const key = row.querySelector('span')?.textContent?.trim();
      const value = row.querySelector('strong')?.textContent?.trim();
      if (key && !(key in rows)) rows[key] = value;
    });
    return {
      hasNotReadyBanner: text.includes('AVATAR NOT READY'),
      hasReadyBanner: text.includes('AVATAR READY'),
      rows,
    };
  };

  await sleep(2000);
  const duringLoad = readPanel();

  const start = performance.now();
  while (performance.now() - start < 90000) {
    const diag = window.__avatarDiagnostics;
    if (diag && diag.vrmProcessed && diag.rendererActive && !document.querySelector('.avatar-overlay')) break;
    await sleep(250);
  }
  await sleep(1200);
  const afterReady = readPanel();

  return {
    duringLoad,
    afterReady,
    diagnostics: window.__avatarDiagnostics,
    fps: window.__avatarDiagnostics ? window.__avatarDiagnostics.loadProgress : null,
  };
})();
