import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SceneManager, type ScenePerformanceSnapshot } from '../services/SceneManager';
import { avatarService } from '../services/AvatarService';
import { PerformanceLab } from '../services/performance/PerformanceLab';
import { avatarDiagnostics } from '../services/avatar/AvatarDiagnostics';
import type { IAvatar, AvatarTransform, AvatarLoadProgress } from '../types/avatar';
import './AvatarCanvas.css';

export interface AvatarCanvasProps {
  modelUrl: string;
  transform?: AvatarTransform;
  onLoaded?: (avatar: IAvatar) => void;
  onError?: (error: Error) => void;
  onPerformanceMetrics?: (snapshot: ScenePerformanceSnapshot) => void;
  onPerformanceLabReady?: (lab: PerformanceLab | null) => void;
}

export const AvatarCanvas: React.FC<AvatarCanvasProps> = ({
  modelUrl,
  transform,
  onLoaded,
  onError,
  onPerformanceMetrics,
  onPerformanceLabReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const performanceLabRef = useRef<PerformanceLab | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const sceneManager = new SceneManager({
      container: containerRef.current,
      backgroundColor: 0xf3f4f6,
    });
    const performanceLab = new PerformanceLab(sceneManager);
    performanceLabRef.current = performanceLab;
    sceneManagerRef.current = sceneManager;
    sceneManager.setPerformanceListener(onPerformanceMetrics ?? null);
    onPerformanceLabReady?.(performanceLab);

    return () => {
      performanceLab.dispose();
      sceneManager.setPerformanceListener(null);
      sceneManager.dispose();
      sceneManagerRef.current = null;
      performanceLabRef.current = null;
      onPerformanceLabReady?.(null);
    };
  }, [onPerformanceLabReady, onPerformanceMetrics]);

  const loadModel = useCallback(() => {
    const sceneManager = sceneManagerRef.current;
    if (!sceneManager) return;

    setLoading(true);
    setError(null);
    setProgress(0);

    avatarService
      .loadAvatar(
        modelUrl,
        (progressInfo: AvatarLoadProgress) => {
          setProgress(progressInfo.progress);
        },
        transform
      )
      .then((avatar) => {
        try {
          if (sceneManagerRef.current) {
            sceneManagerRef.current.setAvatar(avatar);
          }
          setLoading(false);
          onLoaded?.(avatar);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Failed to attach the loaded avatar to the scene';
          console.error('[AvatarCanvas] Failed to attach avatar to scene:', err);
          avatarDiagnostics.fail(err);
          setError(errorMsg);
          setLoading(false);
          onError?.(err instanceof Error ? err : new Error(errorMsg));
        }
      })
      .catch((err: unknown) => {
        const errorMsg =
          err instanceof Error
            ? err.message
            : `Failed to load VRM model from "${modelUrl}"`;
        console.error('[AvatarCanvas] Avatar load failed:', err);
        avatarDiagnostics.fail(err);
        setError(errorMsg);
        setLoading(false);
        onError?.(err instanceof Error ? err : new Error(errorMsg));
      });
  }, [modelUrl, transform, onLoaded, onError]);

  useEffect(() => {
    if (sceneManagerRef.current) {
      loadModel();
    }
  }, [loadModel, retryCount]);

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
  };

  const progressPercent = Math.round(progress * 100);

  return (
    <div ref={containerRef} className="avatar-canvas-container">
      {loading && !error && (
        <div className="avatar-overlay">
          <div className="avatar-card" role="status" aria-live="polite">
            <h3 className="avatar-loading-title">Loading Astheria...</h3>
            <div className="avatar-progress-bar-bg">
              <div
                className="avatar-progress-bar-fill"
                style={{ width: `${Math.max(progressPercent, 5)}%` }}
              />
            </div>
            <p className="avatar-progress-text">
              {progressPercent > 0 ? `${progressPercent}% loaded` : 'Preparing model...'}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="avatar-overlay">
          <div className="avatar-card error-card" role="alert">
            <div className="avatar-error-icon">!</div>
            <h3 className="avatar-error-title">Unable to Load Avatar</h3>
            <p className="avatar-error-message">{error}</p>
            <button
              type="button"
              className="avatar-retry-btn"
              onClick={handleRetry}
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
