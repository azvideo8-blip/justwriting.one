import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTheme } from './ThemeProvider';

const GRADIENT_THEMES: Record<string, { layers: { gradient: string; origin: string }[]; base: string }> = {
  spotify: {
    base: '#090C0A',
    layers: [
      { gradient: 'radial-gradient(ellipse at 30% 40%, #0d2b1a 0%, transparent 65%)', origin: '30% 40%' },
      { gradient: 'radial-gradient(ellipse at 70% 60%, #0a2416 0%, transparent 65%)', origin: '70% 60%' },
      { gradient: 'radial-gradient(ellipse at 50% 20%, #0f2e1c 0%, transparent 65%)', origin: '50% 20%' },
    ],
  },
  modern: {
    base: '#050506',
    layers: [
      { gradient: 'radial-gradient(ellipse at 40% 40%, #1e1e22 0%, transparent 70%)', origin: '40% 40%' },
      { gradient: 'radial-gradient(ellipse at 60% 60%, #16161a 0%, transparent 70%)', origin: '60% 60%' },
      { gradient: 'radial-gradient(ellipse at 50% 30%, #1a1a1e 0%, transparent 70%)', origin: '50% 30%' },
    ],
  },
  amethyst: {
    base: 'var(--brand-bg)',
    layers: [
      { gradient: 'radial-gradient(ellipse at 35% 55%, color-mix(in srgb, var(--brand-primary) 30%, transparent) 0%, transparent 65%)', origin: '35% 55%' },
      { gradient: 'radial-gradient(ellipse at 55% 40%, color-mix(in srgb, var(--brand-primary) 30%, transparent) 0%, transparent 65%)', origin: '55% 40%' },
      { gradient: 'radial-gradient(ellipse at 40% 60%, color-mix(in srgb, var(--brand-primary) 30%, transparent) 0%, transparent 65%)', origin: '40% 60%' },
    ],
  },
  notion: {
    base: '#FAF8F5',
    layers: [
      { gradient: 'radial-gradient(ellipse at 40% 40%, rgba(240,237,230,0.6) 0%, transparent 70%)', origin: '40% 40%' },
      { gradient: 'radial-gradient(ellipse at 60% 60%, rgba(229,225,215,0.4) 0%, transparent 70%)', origin: '60% 60%' },
    ],
  },
  stripe: {
    base: '#0a0514',
    layers: [
      { gradient: 'radial-gradient(ellipse at 35% 55%, rgba(125,79,209,0.2) 0%, transparent 65%)', origin: '35% 55%' },
      { gradient: 'radial-gradient(ellipse at 65% 40%, rgba(74,42,138,0.2) 0%, transparent 65%)', origin: '65% 40%' },
    ],
  },
};

interface ThemeBackgroundProps {
  silenceMode?: boolean;
}

export function ThemeBackground({ silenceMode }: ThemeBackgroundProps) {
  const { resolvedThemeId } = useTheme();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [isVisible, setIsVisible] = useState(() => typeof document !== 'undefined' ? !document.hidden : true);
  const location = useLocation();
  const isWritingPage = location.pathname === '/';

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  if (!(resolvedThemeId in GRADIENT_THEMES)) return null;
  const config = GRADIENT_THEMES[resolvedThemeId]!;

  const shouldAnimate = !prefersReducedMotion && isVisible && isWritingPage && !silenceMode;

  const baseStyle = { zIndex: 0, background: config.base };
  const layerStyle = (layer: { gradient: string; origin: string }, i: number, shouldAnimate: boolean) => ({
    position: 'absolute' as const,
    inset: 0,
    background: layer.gradient,
    transformOrigin: layer.origin,
    opacity: shouldAnimate ? 1 : 0,
    animation: shouldAnimate
      ? `themeBgPulse${i} ${8 + i * 1.5}s ease-in-out infinite alternate`
      : 'none',
    willChange: shouldAnimate ? 'opacity, transform' : 'auto',
  });

  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={baseStyle}
    >
      {config.layers.map((layer, i) => (
        <div
          key={i}
          style={layerStyle(layer, i, shouldAnimate)}
        />
      ))}
    </div>
  );
}
