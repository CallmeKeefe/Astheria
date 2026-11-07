export type QualityTier = 'high' | 'medium' | 'low';

export interface QualityProfile {
  tier: QualityTier;
  maxDpr: number;
  shadows: boolean;
  lightIntensity: number;
}

export function detectQualityTier(): QualityTier {
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency || 4;

  if ((deviceMemory ?? 8) >= 8 && cores >= 8) {
    return 'high';
  }

  if ((deviceMemory ?? 4) >= 4 || cores >= 4) {
    return 'medium';
  }

  return 'low';
}

export function getQualityProfile(tier: QualityTier): QualityProfile {
  switch (tier) {
    case 'high':
      return { tier, maxDpr: 2, shadows: true, lightIntensity: 1.1 };
    case 'medium':
      return { tier, maxDpr: 1.5, shadows: false, lightIntensity: 0.85 };
    default:
      return { tier, maxDpr: 1.25, shadows: false, lightIntensity: 0.7 };
  }
}

export function resolveDpr(tier: QualityTier, devicePixelRatio: number): number {
  const profile = getQualityProfile(tier);
  return Math.min(Math.max(devicePixelRatio, 1), profile.maxDpr);
}
