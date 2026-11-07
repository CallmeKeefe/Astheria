// Probe: verifies the Performance Lab refuses to report measurements when no VRM is live.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const findButton = (label) =>
    Array.from(document.querySelectorAll('button')).find(
      (button) => (button.textContent || '').trim() === label,
    );

  await sleep(8000);

  const snapshotBefore = window.__performanceLab ? window.__performanceLab.getLatestSnapshot() : null;

  const toggle = findButton('Performance Lab OFF');
  if (toggle) {
    toggle.click();
    await sleep(900);
  }

  const measureButton = findButton('Measure Current Test');
  if (measureButton) measureButton.click();
  await sleep(5000);

  const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((el) => el.innerText.trim());
  const panel = document.querySelector('.performance-panel');
  const heading = Array.from(document.querySelectorAll('h3')).find(
    (h) => (h.textContent || '').trim() === 'Last Measurement',
  );

  return {
    overlayText: document.querySelector('.avatar-overlay') ? document.querySelector('.avatar-overlay').innerText.trim() : null,
    diagnostics: window.__avatarDiagnostics,
    snapshotBefore: snapshotBefore
      ? {
          avatarReady: snapshotBefore.avatarReady,
          blocked: snapshotBefore.blocked,
          readinessMessage: snapshotBefore.readinessMessage,
          fps: snapshotBefore.fps,
          frameMs: snapshotBefore.frameMs,
          drawCalls: snapshotBefore.drawCalls,
          triangles: snapshotBefore.triangles,
        }
      : null,
    snapshotAfter: window.__performanceLab
      ? (() => {
          const s = window.__performanceLab.getLatestSnapshot();
          return {
            avatarReady: s.avatarReady,
            blocked: s.blocked,
            readinessMessage: s.readinessMessage,
            fps: s.fps,
            frameMs: s.frameMs,
            drawCalls: s.drawCalls,
            triangles: s.triangles,
          };
        })()
      : null,
    labStatus: window.__performanceLab ? window.__performanceLab.getStatusMessage() : null,
    measurementRendered: Boolean(heading),
    alerts,
    panelText: panel ? panel.innerText.slice(0, 700) : null,
  };
})();
