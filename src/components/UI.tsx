import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './UI.css';
import { avatarService } from '../services/AvatarService';
import { AnimationStateName } from '../services/animation/AnimationState';
import { voiceSessionManager } from '../services/audio/VoiceSessionManager';
import { AvatarVoiceBridge } from '../services/avatar/AvatarVoiceBridge';
import type { ScenePerformanceSnapshot } from '../services/SceneManager';
import type { VoiceInfo } from '../types/audio';
import type { VoiceCapabilities, VoiceSessionState } from '../types/voice-session';
import { PracticeCard, ProgressCard, SkeletonBlock, StudyCard } from './ui/LearningCards';
import type { PerformanceLab } from '../services/performance/PerformanceLab';

export type AppScreen = 'home' | 'companions' | 'precall' | 'session' | 'summary';
export type SessionMode = 'Teacher' | 'Companion' | 'Coach';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface CompanionProfile {
  id: string;
  name: string;
  modelUrl: string;
  style: SessionMode;
  personality: string;
  language: string;
  description: string;
}

interface UIProps {
  performance: ScenePerformanceSnapshot;
  performanceLab: PerformanceLab | null;
  screen: AppScreen;
  onStartSession: () => void;
  onReturnHome: () => void;
  onSelectCompanion: (companion: CompanionProfile) => void;
  selectedCompanion: CompanionProfile;
  onProceedToSession: () => void;
  onEndSession: () => void;
  sessionMode: SessionMode;
  onSessionModeChange: (mode: SessionMode) => void;
  sessionSeconds: number;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

const companionCatalog: CompanionProfile[] = [
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

const formatDuration = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const UI: React.FC<UIProps> = ({
  performance,
  performanceLab,
  screen,
  onStartSession,
  onReturnHome,
  onSelectCompanion,
  selectedCompanion,
  onProceedToSession,
  onEndSession,
  sessionMode,
  onSessionModeChange,
  sessionSeconds,
  theme,
  onThemeChange,
}) => {
  void performanceLab;
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [text, setText] = useState<string>('Hello! I am Astheria, your educational companion.');
  const [rate, setRate] = useState<number>(1);
  const [pitch, setPitch] = useState<number>(1);
  const [volume, setVolume] = useState<number>(1);
  const [language, setLanguage] = useState<string>('English');
  const [sessionState, setSessionState] = useState<VoiceSessionState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [lastError, setLastError] = useState<string>('');
  const [capabilities, setCapabilities] = useState<VoiceCapabilities>(() => voiceSessionManager.getCapabilities());
  const [avatarState, setAvatarState] = useState<string>('idle');
  const [loading, setLoading] = useState<boolean>(true);
  const [showDebug, setShowDebug] = useState<boolean>(false);
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    const bridge = new AvatarVoiceBridge(voiceSessionManager);
    const timeoutId = window.setTimeout(() => setLoading(false), 600);

    void voiceSessionManager.loadVoices().then((v) => {
      setVoices(v);
      const defaultVoice = v.find((voice) => voice.default) || v[0];
      if (defaultVoice) {
        setSelectedVoice(defaultVoice.id);
        setLanguage(defaultVoice.language);
      }
    });

    const unsubscribers = [
      voiceSessionManager.on('state-changed', ({ state }) => setSessionState(state)),
      voiceSessionManager.on('interim-transcript', ({ text }) => setTranscript(`Interim: ${text}`)),
      voiceSessionManager.on('final-transcript', ({ text }) => setTranscript(`Final: ${text}`)),
      voiceSessionManager.on('error', ({ error }) => setLastError(error.message)),
      voiceSessionManager.on('support-changed', ({ capabilities: next }) => setCapabilities(next)),
    ];

    const avatarStateInterval = window.setInterval(() => {
      const avatar = avatarService.avatar;
      if (avatar) {
        setAvatarState(avatar.animationController.getState());
      }
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(avatarStateInterval);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      bridge.dispose();
    };
  }, []);

  const continueLearning = useMemo(
    () => [
      { eyebrow: 'Speaking', title: 'Daily conversation', subtitle: 'Warm up with useful phrases and clear pronunciation.', actionLabel: 'Resume', tone: 'primary' as const },
      { eyebrow: 'Listening', title: 'Short-form comprehension', subtitle: 'Build pattern recognition with concise audio prompts.', actionLabel: 'Review', tone: 'neutral' as const },
      { eyebrow: 'Grammar', title: 'Context clues', subtitle: 'Practice framing meaning before checking the answer.', actionLabel: 'Study', tone: 'success' as const },
    ],
    []
  );

  const quickPractice = useMemo(
    () => [
      { eyebrow: 'Flashcards', title: 'Vocabulary sprint', subtitle: 'Target the most common phrases.', actionLabel: 'Practice', tone: 'primary' as const },
      { eyebrow: 'Review', title: 'Pattern recall', subtitle: 'A short retrieval cycle with hints.', actionLabel: 'Open', tone: 'neutral' as const },
      { eyebrow: 'Progress', title: 'Daily streak', subtitle: 'Keep study momentum going.', actionLabel: 'Check in', tone: 'warning' as const },
    ],
    []
  );

  const progressStats = useMemo(
    () => [
      { label: 'Streak', value: '12d', trend: '+2 vs last week', tone: 'primary' as const },
      { label: 'Accuracy', value: '86%', trend: '+7% this month', tone: 'success' as const },
      { label: 'Focus', value: '28m', trend: 'On target', tone: 'warning' as const },
    ],
    []
  );

  const availableLanguages = useMemo(() => {
    const langs = new Set(voices.map((v) => v.language));
    return Array.from(langs).sort();
  }, [voices]);

  const filteredVoices = useMemo(() => {
    if (!language) return voices;
    return voices.filter((v) => v.language === language);
  }, [voices, language]);

  const handleStateChange = useCallback((state: AnimationStateName) => {
    avatarService.avatar?.animationController.setState(state);
  }, []);

  const handleVoiceChange = useCallback(
    (voiceId: string) => {
      setSelectedVoice(voiceId);
      const voice = voices.find((v) => v.id === voiceId);
      if (voice) {
        setLanguage(voice.language);
      }
    },
    [voices]
  );

  const handleLanguageChange = useCallback(
    (lang: string) => {
      setLanguage(lang);
      const voiceForLang = voices.find((v) => v.language === lang);
      if (voiceForLang) {
        setSelectedVoice(voiceForLang.id);
      }
    },
    [voices]
  );

  const handleSpeak = useCallback(() => {
    const voice = voices.find((v) => v.id === selectedVoice);
    voiceSessionManager.speak(text, {
      voice,
      language: voice?.language || language,
      rate,
      pitch,
      volume,
    });
  }, [voices, selectedVoice, text, rate, pitch, volume, language]);

  const handleStartListening = useCallback(() => {
    setTranscript('');
    setLastError('');
    void voiceSessionManager.startListening(language || undefined);
  }, [language]);

  const handleStopListening = useCallback(() => {
    voiceSessionManager.stopListening();
  }, []);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const currentIndex = order.indexOf(theme);
    const nextTheme = order[(currentIndex + 1) % order.length];
    onThemeChange(nextTheme);
  }, [theme, onThemeChange]);

  const renderDebugPanel = () => (
    <div className="panel performance-panel">
      <div className="panel-header">
        <h3>Development / Debug</h3>
        <button type="button" className="text-button" onClick={() => setShowDebug(false)}>Close</button>
      </div>

      <div className="state-switcher" aria-label="Avatar animation states">
        {Object.values(AnimationStateName).map((state) => (
          <button
            key={state}
            type="button"
            className="state-pill"
            onClick={() => handleStateChange(state as AnimationStateName)}
          >
            {state}
          </button>
        ))}
      </div>

      <div className="studio-panel">
        <div className="status-row">
          <span>Speech</span>
          <strong>{capabilities.speechSynthesis.supported ? 'Supported' : 'Unavailable'}</strong>
        </div>
        <div className="status-row">
          <span>Voice session</span>
          <strong>{sessionState}</strong>
        </div>
        <div className="status-row">
          <span>Avatar state</span>
          <strong>{avatarState}</strong>
        </div>

        <label className="field-label" htmlFor="voice-language">Language</label>
        <select id="voice-language" value={language} onChange={(e) => handleLanguageChange(e.target.value)}>
          {availableLanguages.map((lang) => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>

        <label className="field-label" htmlFor="voice-select">Voice</label>
        <select id="voice-select" value={selectedVoice} onChange={(e) => handleVoiceChange(e.target.value)}>
          {filteredVoices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name} ({voice.language}){voice.localService ? ' [local]' : ''}
            </option>
          ))}
        </select>

        <label className="field-label" htmlFor="speech-text">Prompt</label>
        <input id="speech-text" type="text" value={text} onChange={(e) => setText(e.target.value)} />

        <div className="slider-grid">
          <label>
            <span>Rate {rate.toFixed(1)}</span>
            <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} />
          </label>
          <label>
            <span>Pitch {pitch.toFixed(1)}</span>
            <input type="range" min="0" max="2" step="0.1" value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))} />
          </label>
          <label>
            <span>Volume {volume.toFixed(1)}</span>
            <input type="range" min="0" max="1" step="0.1" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} />
          </label>
        </div>

        <div className="compact-actions">
          <button type="button" className="action-button primary" onClick={handleSpeak}>Speak</button>
          <button type="button" className="action-button" onClick={sessionState === 'listening' ? handleStopListening : handleStartListening}>
            {sessionState === 'listening' ? 'Stop listening' : 'Start listening'}
          </button>
          <button type="button" className="action-button" onClick={() => voiceSessionManager.cancelSpeech()}>Stop voice</button>
        </div>

        <div className="transcript-box">
          <strong>Transcript</strong>
          <p>{transcript || 'No transcript yet.'}</p>
          {lastError ? <small>Error: {lastError}</small> : null}
        </div>
      </div>

      <div className="panel performance-panel compact-panel">
        <div className="panel-header">
          <h3>Performance</h3>
          <span className="status-badge subtle">{performance.qualityTier}</span>
        </div>
        <div className="metrics-grid">
          <div>
            <span>FPS</span>
            <strong>{performance.fps.toFixed(0)}</strong>
          </div>
          <div>
            <span>Frame</span>
            <strong>{performance.frameTime.toFixed(1)} ms</strong>
          </div>
          <div>
            <span>JS</span>
            <strong>{typeof performance.jsUpdateTime === 'number' ? `${performance.jsUpdateTime.toFixed(1)} ms` : 'N/A'}</strong>
          </div>
          <div>
            <span>Render</span>
            <strong>{typeof performance.renderTime === 'number' ? `${performance.renderTime.toFixed(1)} ms` : 'N/A'}</strong>
          </div>
          <div>
            <span>DPR</span>
            <strong>{performance.dpr.toFixed(2)}</strong>
          </div>
          <div>
            <span>Draws</span>
            <strong>{typeof performance.drawCalls === 'number' ? performance.drawCalls.toFixed(0) : 'N/A'}</strong>
          </div>
          <div>
            <span>Tris</span>
            <strong>{typeof performance.triangles === 'number' ? performance.triangles.toFixed(0) : 'N/A'}</strong>
          </div>
          <div>
            <span>Avatar</span>
            <strong>{performance.avatarLoaded ? 'Loaded' : 'Loading'}</strong>
          </div>
          <div>
            <span>In scene</span>
            <strong>{performance.avatarInScene ? 'YES' : 'NO'}</strong>
          </div>
          <div>
            <span>Visible</span>
            <strong>{performance.avatarVisible ? 'YES' : 'NO'}</strong>
          </div>
        </div>
      </div>

    </div>
  );

  const renderHome = () => (
    <div className="experience-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">A</div>
          <div>
            <p className="eyebrow">Study space</p>
            <h1>Astheria</h1>
          </div>
        </div>

        <div className="header-actions">
          <button type="button" className="pill-button ghost" onClick={cycleTheme} aria-label={`Theme mode: ${theme}`}>
            {theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'}
          </button>
          <button type="button" className="pill-button ghost" onClick={() => setShowDebug(true)}>
            {isDev ? 'Development / Debug' : 'Developer mode'}
          </button>
          <button type="button" className="pill-button selected" onClick={onStartSession}>Start a Session</button>
        </div>
      </header>

      <main className="dashboard-layout home-layout">
        <section className="main-column">
          <div className="panel hero-panel">
            <div>
              <p className="eyebrow">Today&apos;s focus</p>
              <h2>Build confidence with short recall loops.</h2>
            </div>
            <div className="hero-meta">
              <span className="status-badge">Coach mode</span>
              <span className="status-badge subtle">28 min</span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3>Continue learning</h3>
              <button type="button" className="text-button">View all</button>
            </div>
            {loading ? (
              <div className="card-grid skeleton-grid">
                <SkeletonBlock variant="card" />
                <SkeletonBlock variant="card" />
                <SkeletonBlock variant="card" />
              </div>
            ) : (
              <div className="card-grid">
                {continueLearning.map((item) => (
                  <StudyCard
                    key={item.title}
                    eyebrow={item.eyebrow}
                    title={item.title}
                    subtitle={item.subtitle}
                    actionLabel={item.actionLabel}
                    tone={item.tone}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3>Quick practice</h3>
              <button type="button" className="text-button">Shuffle</button>
            </div>
            <div className="card-grid compact-grid">
              {quickPractice.map((item) => (
                <PracticeCard
                  key={item.title}
                  eyebrow={item.eyebrow}
                  title={item.title}
                  subtitle={item.subtitle}
                  actionLabel={item.actionLabel}
                  tone={item.tone}
                />
              ))}
            </div>
          </div>
        </section>

        <aside className="side-column">
          <div className="panel">
            <div className="panel-header">
              <h3>Companion mode</h3>
              <span className="status-dot online">Live</span>
            </div>
            <div className="mode-switcher">
              {(['Teacher', 'Companion', 'Coach'] as SessionMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`mode-button ${sessionMode === mode ? 'selected' : ''}`}
                  onClick={() => onSessionModeChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="session-preview">
              <div className="mini-call-card">
                <span className="eyebrow">Ready</span>
                <h3>{selectedCompanion.name}</h3>
                <p>{selectedCompanion.personality}</p>
                <button type="button" className="action-button primary wide" onClick={onStartSession}>Start a Session</button>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3>Progress</h3>
            </div>
            <div className="progress-grid">
              {progressStats.map((stat) => (
                <ProgressCard
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  trend={stat.trend}
                  tone={stat.tone}
                />
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );

  const renderCompanions = () => (
    <div className="experience-shell panel-shell">
      <header className="topbar compact-topbar">
        <div className="brand-block">
          <button type="button" className="icon-button" onClick={onReturnHome} aria-label="Back to home">←</button>
          <div>
            <p className="eyebrow">Choose companion</p>
            <h1>Companions</h1>
          </div>
        </div>

        <button type="button" className="pill-button selected" onClick={() => onSelectCompanion(selectedCompanion)}>
          Start Session
        </button>
      </header>

      <main className="companion-grid">
        {companionCatalog.map((companion) => (
          <button
            key={companion.id}
            type="button"
            className={`companion-card ${selectedCompanion.id === companion.id ? 'selected' : ''}`}
            onClick={() => onSelectCompanion(companion)}
          >
            <div className="companion-card__visual" aria-hidden="true">
              <div className="avatar-badge">{companion.name.slice(0, 1)}</div>
            </div>
            <div className="companion-card__content">
              <div className="companion-card__header">
                <h3>{companion.name}</h3>
                <span>{companion.style}</span>
              </div>
              <p>{companion.description}</p>
              <small>{companion.personality}</small>
            </div>
          </button>
        ))}
      </main>
    </div>
  );

  const renderPreCall = () => (
    <div className="experience-shell panel-shell">
      <header className="topbar compact-topbar">
        <div className="brand-block">
          <button type="button" className="icon-button" onClick={onReturnHome} aria-label="Back to home">←</button>
          <div>
            <p className="eyebrow">Pre-call lobby</p>
            <h1>{selectedCompanion.name}</h1>
          </div>
        </div>
        <button type="button" className="pill-button selected" onClick={onProceedToSession}>Start Session</button>
      </header>

      <main className="lobby-layout">
        <section className="lobby-preview panel">
          <div className="lobby-avatar" aria-label={`${selectedCompanion.name} preview`}>
            <div className="lobby-avatar__orb" aria-hidden="true" />
          </div>
          <div className="lobby-summary">
            <span className="status-badge">Ready</span>
            <h2>{selectedCompanion.name}</h2>
            <p>{selectedCompanion.description}</p>
            <div className="meta-row">
              <span>Voice</span>
              <strong>{selectedCompanion.language}</strong>
            </div>
            <div className="meta-row">
              <span>Mode</span>
              <strong>{sessionMode}</strong>
            </div>
            <div className="mode-switcher lobby-modes">
              {(['Teacher', 'Companion', 'Coach'] as SessionMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`mode-button ${sessionMode === mode ? 'selected' : ''}`}
                  onClick={() => onSessionModeChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );

  const renderSession = () => (
    <div className="experience-shell active-session-shell">
      <header className="call-header">
        <div className="call-header__info">
          <span className="status-dot online">Connected</span>
          <div>
            <h2>{selectedCompanion.name}</h2>
            <p>{sessionMode} mode · {selectedCompanion.language}</p>
          </div>
        </div>
        <button type="button" className="pill-button danger" onClick={onEndSession}>End Session</button>
      </header>

      <main className="session-layout">
        <section className="session-stage panel">
          <div className="session-status-strip">
            <span className="session-state-label">{sessionState === 'listening' ? 'Listening...' : sessionState === 'speaking' ? 'Speaking...' : 'Thinking...'}</span>
            <span className="session-timer">{formatDuration(sessionSeconds)}</span>
          </div>
          <div className="session-avatar-zone" aria-label="Companion session view" />
        </section>

        <aside className="session-context panel">
          <div className="panel-header">
            <h3>Learn</h3>
            <button type="button" className="text-button">Collapse</button>
          </div>

          <div className="context-stack">
            <div className="context-card">
              <span className="eyebrow">Focus</span>
              <strong>Guided reflection</strong>
              <p>Use one question and give space for the learner to respond.</p>
            </div>
            <div className="context-card">
              <span className="eyebrow">Practice</span>
              <strong>Quick prompts</strong>
              <p>Vocabulary recall, sentence framing, and confidence check.</p>
            </div>
            <div className="context-card">
              <span className="eyebrow">Notes</span>
              <strong>Session log</strong>
              <p>Later this can connect to AI-generated summaries and spaced review.</p>
            </div>
          </div>

          <div className="transcript-box session-transcript">
            <strong>Transcript</strong>
            <p>{transcript || 'No transcript yet.'}</p>
            {lastError ? <small>Error: {lastError}</small> : null}
          </div>
        </aside>
      </main>

      <div className="call-controls">
        <button type="button" className="control-button" onClick={sessionState === 'listening' ? handleStopListening : handleStartListening}>
          {sessionState === 'listening' ? 'Stop mic' : 'Mic'}
        </button>
        <button type="button" className="control-button" onClick={handleSpeak}>Talk</button>
        <button type="button" className="control-button" onClick={() => setTranscript('')}>
          Chat
        </button>
        <button type="button" className="control-button" onClick={() => voiceSessionManager.pauseSpeech()}>Audio</button>
        <button type="button" className="control-button danger" onClick={onEndSession}>End</button>
      </div>
    </div>
  );

  const renderSummary = () => (
    <div className="experience-shell panel-shell">
      <header className="topbar compact-topbar">
        <div className="brand-block">
          <div>
            <p className="eyebrow">Session summary</p>
            <h1>Great work</h1>
          </div>
        </div>
        <button type="button" className="pill-button selected" onClick={onReturnHome}>Back home</button>
      </header>

      <main className="summary-layout">
        <section className="panel summary-card">
          <div className="summary-header">
            <h2>{selectedCompanion.name}</h2>
            <span className="status-badge subtle">{sessionMode}</span>
          </div>

          <div className="summary-grid">
            <div>
              <span>Duration</span>
              <strong>{formatDuration(sessionSeconds)}</strong>
            </div>
            <div>
              <span>Language</span>
              <strong>{selectedCompanion.language}</strong>
            </div>
            <div>
              <span>Focus</span>
              <strong>Guided reflection</strong>
            </div>
            <div>
              <span>Progress</span>
              <strong>Ready for next step</strong>
            </div>
          </div>

          <button type="button" className="action-button primary wide" onClick={onReturnHome}>Return to home</button>
        </section>
      </main>
    </div>
  );

  return (
    <>
      {screen === 'home' && renderHome()}
      {screen === 'companions' && renderCompanions()}
      {screen === 'precall' && renderPreCall()}
      {screen === 'session' && renderSession()}
      {screen === 'summary' && renderSummary()}
      {showDebug && isDev && renderDebugPanel()}
      <footer className="ui-footer">
        <div className="footer-inner">
          <span>© Steven Keefe</span>
          <nav aria-label="Footer links">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Cookies</a>
            <a href="#">About</a>
          </nav>
        </div>
      </footer>
    </>
  );
};
