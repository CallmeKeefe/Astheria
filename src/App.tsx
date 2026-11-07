import { useEffect, useState } from 'react';
import { AvatarCanvas } from './components/AvatarCanvas';
import { UI, type CompanionProfile, type AppScreen, type SessionMode, type ThemeMode } from './components/UI';
import { PerformanceLabPanel } from './components/PerformanceLabPanel';
import './App.css';
import type { ScenePerformanceSnapshot } from './services/SceneManager';
import type { PerformanceLab } from './services/performance/PerformanceLab';

const defaultPerformance: ScenePerformanceSnapshot = {
  fps: 0,
  frameTime: 0,
  dpr: 1,
  qualityTier: 'medium',
  avatarLoaded: false,
  avatarInScene: false,
  avatarVisible: false,
  avatarAnimationState: 'idle',
};

export const companionCatalog: CompanionProfile[] = [
  {
    id: 'nova',
    name: 'Nova',
    modelUrl: '/avatar.vrm',
    style: 'Teacher',
    personality: 'Clear and calm guidance',
    language: 'English',
    description: 'A focused study partner tuned for structured explanations and confidence-building practice.',
  },
  {
    id: 'luna',
    name: 'Luna',
    modelUrl: '/avatar.vrm',
    style: 'Companion',
    personality: 'Warm and conversational',
    language: 'English',
    description: 'A gentle companion for everyday conversation practice and context-rich learning.',
  },
  {
    id: 'echo',
    name: 'Echo',
    modelUrl: '/avatar.vrm',
    style: 'Coach',
    personality: 'Motivating and progress-led',
    language: 'English',
    description: 'A supportive coach focused on streaks, goal tracking, and short learning loops.',
  },
];

function App() {
  const [modelUrl, setModelUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const m = params.get('model');
      if (m) return m;
    }
    return '/avatar.vrm';
  });
  const initialScreen = (() => {
    if (typeof window === 'undefined') return 'home';
    const params = new URLSearchParams(window.location.search);
    const s = params.get('screen');
    if (s === 'home' || s === 'companions' || s === 'precall' || s === 'session' || s === 'summary') return s;
    return 'home';
  })();
  const [performance, setPerformance] = useState<ScenePerformanceSnapshot>(defaultPerformance);
  const [screen, setScreen] = useState<AppScreen>(initialScreen);
  const [selectedCompanion, setSelectedCompanion] = useState<CompanionProfile>(companionCatalog[0]);
  const [sessionMode, setSessionMode] = useState<SessionMode>('Teacher');
  const [sessionSeconds, setSessionSeconds] = useState<number>(0);
  const [performanceLab, setPerformanceLab] = useState<PerformanceLab | null>(null);
  const [showUi, setShowUi] = useState<boolean>(true);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system';
    const stored = window.localStorage.getItem('asteria-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    return 'system';
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const systemDark = media.matches;
      const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
      document.documentElement.setAttribute('data-theme', resolvedTheme);
      window.localStorage.setItem('asteria-theme', theme);
    };

    applyTheme();
    media.addEventListener?.('change', applyTheme);
    return () => media.removeEventListener?.('change', applyTheme);
  }, [theme]);

  useEffect(() => {
    const unsubscribe = performanceLab?.subscribeToModeChanges((mode) => {
      setShowUi(mode !== 'NO_UI');
    });

    setShowUi(performanceLab?.getCurrentMode() !== 'NO_UI');

    return () => unsubscribe?.();
  }, [performanceLab]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('screen', screen);
    const url = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', url);
  }, [screen]);

  useEffect(() => {
    if (screen !== 'session') return;

    const intervalId = window.setInterval(() => {
      setSessionSeconds((previous) => previous + 1);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [screen]);

  const handleSelectCompanion = (companion: CompanionProfile) => {
    setSelectedCompanion(companion);
    setModelUrl(companion.modelUrl);
    setScreen('precall');
  };

  const handleProceedToSession = () => {
    setSessionSeconds(0);
    setScreen('session');
  };

  const handleEndSession = () => {
    if (window.confirm('End this session? Your transcript will be cleared.')) {
      setScreen('summary');
    }
  };

  return (
    <main className="app-container">
      <div className="app-shell">
        <AvatarCanvas modelUrl={modelUrl} onPerformanceMetrics={setPerformance} onPerformanceLabReady={setPerformanceLab} />
        {showUi && <UI
          performance={performance}
          performanceLab={performanceLab}
          screen={screen}
          onStartSession={() => setScreen('companions')}
          onReturnHome={() => setScreen('home')}
          onSelectCompanion={handleSelectCompanion}
          selectedCompanion={selectedCompanion}
          onProceedToSession={handleProceedToSession}
          onEndSession={handleEndSession}
          sessionMode={sessionMode}
          onSessionModeChange={setSessionMode}
          sessionSeconds={sessionSeconds}
          theme={theme}
          onThemeChange={setTheme}
        />}
        {import.meta.env.DEV && performanceLab && <PerformanceLabPanel performanceLab={performanceLab} />}
      </div>
    </main>
  );
}

export default App;
