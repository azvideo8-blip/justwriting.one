import React, { useState, useEffect } from 'react';
import { useReducedMotion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { useTheme } from './ThemeProvider';

const GRADIENT_THEMES: Record<string, { layers: { gradient: string; origin: string }[]; base: string }> = {
  spotify: {
    base: '#121212',
    layers: [
      { gradient: 'radial-gradient(ellipse at 30% 40%, #0d2b1a 0%, transparent 65%)', origin: '30% 40%' },
      { gradient: 'radial-gradient(ellipse at 70% 60%, #0a2416 0%, transparent 65%)', origin: '70% 60%' },
      { gradient: 'radial-gradient(ellipse at 50% 20%, #0f2e1c 0%, transparent 65%)', origin: '50% 20%' },
    ],
  },
  modern: {
    base: '#0A0A0B',
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
};

export function ThemeBackground() {
  const { themeId } = useTheme();
  const reducedMotion = useReducedMotion();
  const [isVisible, setIsVisible] = useState(() => typeof document !== 'undefined' ? !document.hidden : true);
  const location = useLocation();
  const isWritingPage = location.pathname === '/';

  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const config = GRADIENT_THEMES[themeId];
  if (!config) return null;

  const shouldAnimate = !reducedMotion && isVisible && isWritingPage;

  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0, background: config.base }}
    >
      {config.layers.map((layer, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            inset: 0,
            background: layer.gradient,
            transformOrigin: layer.origin,
            opacity: shouldAnimate ? 1 : 0,
            animation: shouldAnimate
              ? `themeBgPulse${i} ${8 + i * 1.5}s ease-in-out infinite alternate`
              : 'none',
            willChange: shouldAnimate ? 'opacity, transform' : 'auto',
          }}
        />
      ))}
    </div>
  );
}
