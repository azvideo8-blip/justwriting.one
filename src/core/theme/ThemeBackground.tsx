import React, { useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { useTheme } from './ThemeProvider';

export function ThemeBackground() {
  const { themeId } = useTheme();
  const reducedMotion = useReducedMotion();
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const location = useLocation();
  const isWritingPage = location.pathname === '/';

  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const shouldAnimate = !reducedMotion && isVisible && isWritingPage;

  // Spotify — subtle dark green pulse
  if (themeId === 'spotify') {
    return (
      <motion.div
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 0 }}
        animate={shouldAnimate ? {
          background: [
            'radial-gradient(ellipse at 30% 40%, #0d2b1a 0%, #121212 65%)',
            'radial-gradient(ellipse at 70% 60%, #0a2416 0%, #121212 65%)',
            'radial-gradient(ellipse at 50% 20%, #0f2e1c 0%, #121212 65%)',
          ],
        } : {}}
        transition={{ duration: 7, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
      />
    );
  }

  // Modern — existing animation (keep as is)
  if (themeId === 'modern') {
    return (
      <motion.div
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 0 }}
        animate={shouldAnimate ? {
          background: [
            'radial-gradient(ellipse at 40% 40%, #1e1e22 0%, #0A0A0B 70%)',
            'radial-gradient(ellipse at 60% 60%, #16161a 0%, #0A0A0B 70%)',
            'radial-gradient(ellipse at 50% 30%, #1a1a1e 0%, #0A0A0B 70%)',
          ],
        } : {}}
        transition={{ duration: 8, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
      />
    );
  }

  if (themeId === 'amethyst') {
    if (!shouldAnimate) {
      return (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: 0,
            background: 'radial-gradient(ellipse at 35% 55%, color-mix(in srgb, var(--brand-primary) 30%, transparent) 0%, var(--brand-bg) 65%)',
          }}
        />
      );
    }
    return (
      <motion.div
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 0 }}
        animate={{
          background: [
            'radial-gradient(ellipse at 35% 55%, color-mix(in srgb, var(--brand-primary) 30%, transparent) 0%, var(--brand-bg) 65%)',
            'radial-gradient(ellipse at 55% 40%, color-mix(in srgb, var(--brand-primary) 30%, transparent) 0%, var(--brand-bg) 65%)',
            'radial-gradient(ellipse at 40% 60%, color-mix(in srgb, var(--brand-primary) 30%, transparent) 0%, var(--brand-bg) 65%)',
          ],
        }}
        transition={{ duration: 10, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
      />
    );
  }

  // Notion — plain white, no background component needed
  return null;
}
