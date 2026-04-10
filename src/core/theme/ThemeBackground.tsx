import React from 'react';
import { motion } from 'motion/react';
import { useTheme } from './ThemeProvider';

export function ThemeBackground() {
  const { themeId } = useTheme();

  // Stripe — deep purple gradient shifting slowly
  if (themeId === 'stripe') {
    return (
      <motion.div
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 0 }}
        animate={{
          background: [
            'radial-gradient(ellipse at 20% 50%, #1a0533 0%, #0a0514 60%)',
            'radial-gradient(ellipse at 80% 30%, #170a38 0%, #0a0514 60%)',
            'radial-gradient(ellipse at 50% 80%, #130326 0%, #0a0514 60%)',
          ],
        }}
        transition={{ duration: 10, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
      />
    );
  }

  // Spotify — subtle dark green pulse
  if (themeId === 'spotify') {
    return (
      <motion.div
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 0 }}
        animate={{
          background: [
            'radial-gradient(ellipse at 30% 40%, #0d2b1a 0%, #121212 65%)',
            'radial-gradient(ellipse at 70% 60%, #0a2416 0%, #121212 65%)',
            'radial-gradient(ellipse at 50% 20%, #0f2e1c 0%, #121212 65%)',
          ],
        }}
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
        animate={{
          background: [
            'radial-gradient(ellipse at 40% 40%, #1e1e22 0%, #0A0A0B 70%)',
            'radial-gradient(ellipse at 60% 60%, #16161a 0%, #0A0A0B 70%)',
            'radial-gradient(ellipse at 50% 30%, #1a1a1e 0%, #0A0A0B 70%)',
          ],
        }}
        transition={{ duration: 8, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
      />
    );
  }

  // Notion — plain white, no background component needed
  return null;
}
