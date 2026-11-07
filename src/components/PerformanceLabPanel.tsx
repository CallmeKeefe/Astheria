import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PerformanceLab, PerformanceLabMeasurement, PerformanceLabToggle } from '../services/performance/PerformanceLab';

interface PerformanceLabPanelProps {
  performanceLab: PerformanceLab | null;
}

const testSequence: PerformanceLabToggle[] = ['FULL', 'NO_AVATAR', 'NO_SHADOWS', 'SHADOW_DIAGNOSTIC', 'NO_LIGHTING', 'NO_ENVIRONMENT', 'EMPTY_SCENE', 'SIMPLE_CUBE', 'AVATAR_STATIC', 'NO_UI'];

const formatValue = (value: number | string | undefined): string => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'N/A';
    return value.toFixed(2);
  }
  if (value === undefined || value === null) return 'N/A';
  return value;
};

export const PerformanceLabPanel: React.FC<PerformanceLabPanelProps> = ({ performanceLab }) => {
  const [labEnabled, setLabEnabled] = useState(false);
  const [selectedMode, setSelectedMode] = useState<PerformanceLabToggle>('FULL');
  const [panelRefreshCount, setPanelRefreshCount] = useState(0);
  const [measureResult, setMeasureResult] = useState<PerformanceLabMeasurement | null>(null);
  const [testResults, setTestResults] = useState<Record<PerformanceLabToggle, PerformanceLabMeasurement | string>>({} as Record<PerformanceLabToggle, PerformanceLabMeasurement | string>);
  const [busy, setBusy] = useState(false);
  // Synchronous mirror of `busy` so the 400ms refresh can be silenced without
  // waiting for a render — no panel updates during a measurement window.
  const busyRef = useRef(false);
  const [rawReport, setRawReport] = useState<string>('');

  const setBusyFlag = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  const snapshot = performanceLab ? performanceLab.getLatestSnapshot() : null;
  const currentMode = performanceLab?.getCurrentMode() ?? selectedMode;
  const statusText = performanceLab?.getStatusMessage() ?? 'Idle';
  const blocked = snapshot ? snapshot.blocked : true;
  const readinessMessage = snapshot?.readinessMessage ?? 'AVATAR NOT READY — load not started';

  useEffect(() => {
    if (!performanceLab) return;
    performanceLab.setEnabled(labEnabled);
    const intervalId = window.setInterval(() => {
      // Stay silent while a measurement window is open.
      if (busyRef.current) return;
      setSelectedMode(performanceLab.getCurrentMode());
      setPanelRefreshCount((previous) => previous + 1);
    }, 400);
    return () => window.clearInterval(intervalId);
  }, [performanceLab, labEnabled]);

  const summaryRows = useMemo(() => {
    if (!snapshot) return [];
    const na = '—';
    return [
      { label: 'Avatar Loaded', value: snapshot.avatarLoaded ? 'YES' : 'NO' },
      { label: 'Avatar In Scene', value: snapshot.avatarInScene ? 'YES' : 'NO' },
      { label: 'Avatar Visible', value: snapshot.avatarVisible ? 'YES' : 'NO' },
      { label: 'Renderer Active', value: snapshot.rendererActive ? 'YES' : 'NO' },
      { label: 'Raw FPS', value: blocked ? na : formatValue(snapshot.rawFPS) },
      { label: 'Raw Frame', value: blocked ? na : `${formatValue(snapshot.rawFrameMs)} ms` },
      { label: 'Simulation Delta', value: blocked ? na : `${formatValue(snapshot.simulationDeltaMs)} ms` },
      { label: 'Update', value: blocked ? na : `${formatValue(snapshot.updateMs)} ms` },
      { label: 'Render CPU', value: blocked ? na : `${formatValue(snapshot.renderMs)} ms` },
      {
        label: 'Long Tasks',
        value: snapshot.longTasks.available
          ? `${snapshot.longTasks.count} / ${snapshot.longTasks.totalMs.toFixed(1)} ms / max ${snapshot.longTasks.maxMs.toFixed(1)} ms`
          : 'Long-task API unavailable',
      },
      { label: 'DPR', value: formatValue(snapshot.dpr) },
      { label: 'Canvas', value: `${snapshot.canvasWidth}x${snapshot.canvasHeight}` },
      { label: 'Draws', value: blocked ? na : formatValue(snapshot.drawCalls) },
      { label: 'Triangles', value: blocked ? na : formatValue(snapshot.triangles) },
      { label: 'Geometries', value: blocked ? na : formatValue(snapshot.geometries) },
      { label: 'Textures', value: blocked ? na : formatValue(snapshot.textures) },
      { label: 'GPU', value: snapshot.gpuTiming },
    ];
  }, [snapshot, blocked]);

  const applyCurrentMode = () => {
    if (!performanceLab) return;
    performanceLab.applyTestMode(selectedMode);
    setSelectedMode(performanceLab.getCurrentMode());
    setPanelRefreshCount((previous) => previous + 1);
  };

  const [measureError, setMeasureError] = useState<string>('');

  const runCurrentMeasure = async () => {
    if (!performanceLab) return;
    setBusyFlag(true);
    setMeasureError('');
    try {
      const result = await performanceLab.measure('Measure', selectedMode);
      setMeasureResult(result);
      setTestResults((previous) => ({ ...previous, [result.mode]: result }));
      setRawReport(JSON.stringify({
        label: result.label,
        mode: result.mode,
        avatarReady: result.avatarReady,
        readinessMessage: result.readinessMessage,
        rawFPS: result.rawFPS,
        rawFrameMs: result.rawFrameMs,
        simulationDeltaMs: result.simulationDeltaMs,
        frameCount: result.frameCount,
        measureWindowMs: result.measureWindowMs,
        updateMs: result.updateMs,
        renderCpuMs: result.renderMs,
        cpu: result.cpu,
        gpuTiming: result.gpuTiming,
        gpuMs: result.gpuMs,
        gpuInfo: result.gpuInfo,
        shadowState: result.shadowState,
        longTasks: result.longTasks,
        drawCalls: result.drawCalls,
        triangles: result.triangles,
        rendererMemory: {
          geometries: result.geometries,
          textures: result.textures,
        },
        canvas: {
          width: result.canvasWidth,
          height: result.canvasHeight,
          drawingBufferWidth: result.drawingBufferWidth,
          drawingBufferHeight: result.drawingBufferHeight,
        },
        dpr: result.dpr,
      }, null, 2));
      setSelectedMode(result.mode);
    } catch (error) {
      // A blocked measurement is an expected, explicit outcome - never a silent pass.
      setMeasureError(error instanceof Error ? error.message : String(error));
    } finally {
      setPanelRefreshCount((previous) => previous + 1);
      setBusyFlag(false);
    }
  };

  const restoreFull = () => {
    if (!performanceLab) return;
    performanceLab.restoreFullState();
    setSelectedMode('FULL');
    setPanelRefreshCount((previous) => previous + 1);
  };

  const runAll = async () => {
    if (!performanceLab) return;
    setBusyFlag(true);
    setMeasureError('');
    try {
      const results = await performanceLab.runAllTests();
      setTestResults(results);
    } finally {
      setPanelRefreshCount((previous) => previous + 1);
      setBusyFlag(false);
    }
  };

  const copyReport = async () => {
    if (!rawReport) return;
    try {
      await navigator.clipboard.writeText(rawReport);
    } catch {
      // Ignore clipboard failures in unsupported environments.
    }
  };

  if (!performanceLab) return null;

  return (
    <div className="panel performance-panel compact-panel" style={{ marginTop: '0.75rem' }} data-refresh-count={panelRefreshCount}>
      <div className="panel-header">
        <h3>Performance Lab</h3>
        <div className="compact-actions">
          <button type="button" className="action-button primary" onClick={() => setLabEnabled((previous) => !previous)}>
            {labEnabled ? 'Performance Lab ON' : 'Performance Lab OFF'}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <div><strong>Current Test Mode:</strong> {currentMode}</div>
        <div><strong>Status:</strong> {statusText}</div>
      </div>

      {blocked ? (
        <div
          role="alert"
          style={{
            marginBottom: '0.75rem',
            padding: '0.6rem 0.75rem',
            borderRadius: 10,
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'rgba(239, 68, 68, 0.08)',
          }}
        >
          <strong style={{ display: 'block', color: '#b91c1c' }}>AVATAR NOT READY</strong>
          <div style={{ fontSize: '0.76rem' }}>{readinessMessage}</div>
          <div style={{ fontSize: '0.72rem', opacity: 0.8 }}>
            MEASUREMENT BLOCKED — AVATAR NOT LOADED. Measurements stay hidden until the real VRM scene is live.
          </div>
        </div>
      ) : (
        <div
          role="status"
          style={{
            marginBottom: '0.75rem',
            padding: '0.5rem 0.75rem',
            borderRadius: 10,
            border: '1px solid rgba(34, 197, 94, 0.35)',
            background: 'rgba(34, 197, 94, 0.08)',
            fontSize: '0.78rem',
          }}
        >
          <strong>AVATAR READY</strong> — measuring the live VRM scene.
        </div>
      )}

      {measureError && (
        <div role="alert" style={{ marginBottom: '0.75rem', fontSize: '0.76rem', color: '#b91c1c' }}>
          {measureError}
        </div>
      )}

      <div className="compact-actions" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <label htmlFor="performance-lab-mode" style={{ marginRight: '0.5rem' }}>
          <span style={{ marginRight: '0.35rem' }}>Test Mode:</span>
          <select id="performance-lab-mode" value={selectedMode} onChange={(event) => setSelectedMode(event.target.value as PerformanceLabToggle)}>
            {testSequence.map((test) => (
              <option key={test} value={test}>{test}</option>
            ))}
          </select>
        </label>
        <button type="button" className="action-button" onClick={applyCurrentMode} disabled={busy}>Apply</button>
        <button type="button" className="action-button" onClick={runCurrentMeasure} disabled={busy}>Measure Current Test</button>
        <button type="button" className="action-button" onClick={restoreFull} disabled={busy}>Restore FULL</button>
        <button type="button" className="action-button" onClick={runAll} disabled={busy}>Run All Tests</button>
      </div>

      <div className="metrics-grid">
        {summaryRows.map((row) => (
          <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>
        ))}
      </div>

      {measureResult && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="panel-header" style={{ marginBottom: 8 }}><h3>Last Measurement</h3></div>
          <div className="metrics-grid">
            <div><span>Test</span><strong>{measureResult.mode}</strong></div>
            <div><span>Raw FPS</span><strong>{formatValue(measureResult.rawFPS)}</strong></div>
            <div><span>Raw Frame</span><strong>{`${formatValue(measureResult.rawFrameMs)} ms`}</strong></div>
            <div><span>Simulation Delta</span><strong>{`${formatValue(measureResult.simulationDeltaMs)} ms`}</strong></div>
            <div><span>Update</span><strong>{`${formatValue(measureResult.cpu.sceneManagerUpdateMs)} ms`}</strong></div>
            <div><span>Render CPU</span><strong>{`${formatValue(measureResult.cpu.renderMs)} ms`}</strong></div>
            <div><span>GPU</span><strong>{measureResult.gpuMs === null ? measureResult.gpuTiming : `${measureResult.gpuMs.toFixed(2)} ms`}</strong></div>
            <div><span>Draws</span><strong>{formatValue(measureResult.drawCalls)}</strong></div>
            <div><span>Triangles</span><strong>{formatValue(measureResult.triangles)}</strong></div>
            <div><span>Frames</span><strong>{measureResult.frameCount}</strong></div>
            <div>
              <span>Long tasks</span>
              <strong>
                {measureResult.longTasks.available
                  ? `${measureResult.longTasks.count} / ${measureResult.longTasks.totalMs.toFixed(1)} ms / max ${measureResult.longTasks.maxMs.toFixed(1)} ms`
                  : 'Long-task API unavailable'}
              </strong>
            </div>
            <div><span>Canvas</span><strong>{`${measureResult.canvasWidth}x${measureResult.canvasHeight}`}</strong></div>
            <div><span>DPR</span><strong>{formatValue(measureResult.dpr)}</strong></div>
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <button type="button" className="action-button" onClick={copyReport}>Copy Report</button>
          </div>
          {rawReport && (
            <pre style={{ marginTop: '0.75rem', whiteSpace: 'pre-wrap', fontSize: '0.68rem', overflow: 'auto' }}>{rawReport}</pre>
          )}
        </div>
      )}

      <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.35rem 0.25rem' }}>Test</th>
              <th style={{ textAlign: 'right', padding: '0.35rem 0.25rem' }}>Raw FPS</th>
              <th style={{ textAlign: 'right', padding: '0.35rem 0.25rem' }}>Raw Frame ms</th>
              <th style={{ textAlign: 'right', padding: '0.35rem 0.25rem' }}>Sim ms</th>
              <th style={{ textAlign: 'right', padding: '0.35rem 0.25rem' }}>Update ms</th>
              <th style={{ textAlign: 'right', padding: '0.35rem 0.25rem' }}>Render CPU ms</th>
              <th style={{ textAlign: 'right', padding: '0.35rem 0.25rem' }}>Draws</th>
              <th style={{ textAlign: 'right', padding: '0.35rem 0.25rem' }}>Tris</th>
              <th style={{ textAlign: 'left', padding: '0.35rem 0.25rem' }}>Long Tasks</th>
              <th style={{ textAlign: 'left', padding: '0.35rem 0.25rem' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {testSequence.map((test) => {
              const row = testResults[test];
              const cell = '0.35rem 0.25rem';
              if (!row) {
                return (
                  <tr key={test}>
                    <td style={{ padding: cell }}>{test}</td>
                    <td style={{ padding: cell, textAlign: 'right' }}>N/A</td>
                    <td style={{ padding: cell, textAlign: 'right' }}>N/A</td>
                    <td style={{ padding: cell, textAlign: 'right' }}>N/A</td>
                    <td style={{ padding: cell, textAlign: 'right' }}>N/A</td>
                    <td style={{ padding: cell, textAlign: 'right' }}>N/A</td>
                    <td style={{ padding: cell, textAlign: 'right' }}>N/A</td>
                    <td style={{ padding: cell, textAlign: 'right' }}>N/A</td>
                    <td style={{ padding: cell }}>N/A</td>
                    <td style={{ padding: cell }}>Not run</td>
                  </tr>
                );
              }

              if (typeof row === 'string') {
                return (
                  <tr key={test}>
                    <td style={{ padding: cell }}>{test}</td>
                    <td style={{ padding: cell, textAlign: 'right' }} colSpan={8}>N/A</td>
                    <td style={{ padding: cell }}>{row}</td>
                  </tr>
                );
              }

              const longTasks = row.longTasks.available
                ? `${row.longTasks.count} / ${row.longTasks.totalMs.toFixed(0)} ms / max ${row.longTasks.maxMs.toFixed(0)} ms`
                : 'Long-task API unavailable';

              return (
                <tr key={test}>
                  <td style={{ padding: cell }}>{test}</td>
                  <td style={{ padding: cell, textAlign: 'right' }}>{formatValue(row.rawFPS)}</td>
                  <td style={{ padding: cell, textAlign: 'right' }}>{formatValue(row.rawFrameMs)}</td>
                  <td style={{ padding: cell, textAlign: 'right' }}>{formatValue(row.simulationDeltaMs)}</td>
                  <td style={{ padding: cell, textAlign: 'right' }}>{formatValue(row.updateMs)}</td>
                  <td style={{ padding: cell, textAlign: 'right' }}>{formatValue(row.renderMs)}</td>
                  <td style={{ padding: cell, textAlign: 'right' }}>{formatValue(row.drawCalls)}</td>
                  <td style={{ padding: cell, textAlign: 'right' }}>{formatValue(row.triangles)}</td>
                  <td style={{ padding: cell }}>{longTasks}</td>
                  <td style={{ padding: cell }}>{row.avatarReady ? 'OK' : 'BLOCKED'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {snapshot?.renderer && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="panel-header" style={{ marginBottom: 8 }}><h3>Renderer</h3></div>
          <div className="metrics-grid">
            <div><span>WebGL</span><strong>{snapshot.renderer.webglVersion}</strong></div>
            <div><span>Antialias</span><strong>{snapshot.renderer.antialias ? 'On' : 'Off'}</strong></div>
            <div><span>Pixel ratio</span><strong>{formatValue(snapshot.renderer.pixelRatio)}</strong></div>
            <div><span>Canvas</span><strong>{`${snapshot.canvasWidth}x${snapshot.canvasHeight}`}</strong></div>
            <div><span>Draw buffer</span><strong>{`${snapshot.drawingBufferWidth}x${snapshot.drawingBufferHeight}`}</strong></div>
            <div><span>Shadows</span><strong>{snapshot.renderer.shadowMapEnabled ? 'On' : 'Off'}</strong></div>
            <div><span>Tone mapping</span><strong>{snapshot.renderer.toneMapping}</strong></div>
            <div><span>GPU timing</span><strong>{snapshot.gpuTiming}</strong></div>
            <div>
              <span>GPU renderer</span>
              <strong>{snapshot.gpuInfo.available ? snapshot.gpuInfo.renderer : 'GPU renderer identification unavailable'}</strong>
            </div>
            <div>
              <span>GPU vendor</span>
              <strong>{snapshot.gpuInfo.available ? snapshot.gpuInfo.vendor : 'GPU renderer identification unavailable'}</strong>
            </div>
            <div>
              <span>Shadows (app / measured)</span>
              <strong>
                {`${snapshot.shadowState.originalEnabled ? 'On' : 'Off'} / ${snapshot.shadowState.measuredEnabled ? 'On' : 'Off'} (${snapshot.shadowState.lightsCastShadow} shadow lights, ${snapshot.shadowState.meshesCastShadow} casting meshes)`}
              </strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
