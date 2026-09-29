import { motion, useReducedMotion } from 'motion/react';

const glow = (pct: number) =>
  `0px 0px 60px 0px color-mix(in srgb, var(--brand-soft) ${pct}%, transparent)`;

export type SessionGlowPhase = 'off' | 'breath' | 'ring';

/**
 * DC-W1: «дыхание» карточки редактора на старте сессии — один мягкий
 * всплеск бренд-свечения ~600 мс, потом слабое ровное кольцо до конца
 * сессии. Живёт внутри обёртки редактора (position: relative), поэтому
 * работает и без карточки (editorWidth 100), и в режиме тишины.
 */
export function SessionGlow({ phase }: { phase: SessionGlowPhase }) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      aria-hidden="true"
      data-testid="session-glow"
      className="absolute inset-0 rounded-2xl pointer-events-none z-10"
      initial={false}
      animate={phase}
      variants={{
        off: {
          opacity: 0,
          boxShadow: glow(0),
          transition: { duration: reducedMotion ? 0 : 0.6 },
        },
        breath: {
          opacity: [0, 1, 0.55, 0.5],
          boxShadow: [glow(18), glow(30), glow(30), glow(18)],
          transition: reducedMotion
            ? { duration: 0 }
            : { duration: 0.6, times: [0, 0.4, 0.75, 1], ease: 'easeOut' },
        },
        ring: { opacity: 0.5, boxShadow: glow(18) },
      }}
    />
  );
}
