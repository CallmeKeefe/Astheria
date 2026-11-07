import React from 'react';
import './LearningCards.css';

export type CardTone = 'primary' | 'neutral' | 'success' | 'warning';

interface BaseCardProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  tone?: CardTone;
  disabled?: boolean;
}

export const StudyCard: React.FC<BaseCardProps> = ({
  eyebrow,
  title,
  subtitle,
  actionLabel = 'Open',
  tone = 'neutral',
  disabled = false,
}) => (
  <article className={`study-card tone-${tone} study-card-enhanced`} aria-label={title}>
    {eyebrow ? <span className="study-card__eyebrow">{eyebrow}</span> : null}
    <h3>{title}</h3>
    {subtitle ? <p>{subtitle}</p> : null}
    <button type="button" className="study-card__action enhanced-action" disabled={disabled}>
      <span>{actionLabel}</span>
    </button>
  </article>
);

export const PracticeCard: React.FC<BaseCardProps> = ({
  eyebrow,
  title,
  subtitle,
  actionLabel = 'Practice',
  tone = 'primary',
}) => (
  <article className={`study-card tone-${tone} practice-card enhanced-card`} aria-label={title}>
    {eyebrow ? <span className="study-card__eyebrow">{eyebrow}</span> : null}
    <h3>{title}</h3>
    {subtitle ? <p>{subtitle}</p> : null}
    <button type="button" className="study-card__action muted enhanced-action">
      <span>{actionLabel}</span>
    </button>
  </article>
);

export const ProgressCard: React.FC<{
  label: string;
  value: string;
  trend?: string;
  tone?: CardTone;
}> = ({ label, value, trend, tone = 'neutral' }) => (
  <div className={`progress-card tone-${tone}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    {trend ? <small>{trend}</small> : null}
  </div>
);

export const EmptyStateCard: React.FC<{
  title: string;
  detail: string;
  actionLabel?: string;
}> = ({ title, detail, actionLabel = 'View all' }) => (
  <div className="empty-state-card" role="status" aria-live="polite">
    <div className="empty-state-card__icon" aria-hidden="true">
      +
    </div>
    <h3>{title}</h3>
    <p>{detail}</p>
    <button type="button" className="study-card__action">
      {actionLabel}
    </button>
  </div>
);

export const SkeletonBlock: React.FC<{ variant?: 'card' | 'line' | 'circle' }> = ({ variant = 'card' }) => (
  <div className={`skeleton-block skeleton-${variant}`} aria-hidden="true" />
);