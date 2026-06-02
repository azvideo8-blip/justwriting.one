import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { useLanguage } from "../../../core/i18n";

interface WpmChartProps {
  data: { timestamp: number; wpm: number }[];
  avgWpm?: number;
  height?: number;
}

export function WpmChart({ data, avgWpm, height = 72 }: WpmChartProps) {
  const { t } = useLanguage();
  const reducedMotion = useReducedMotion();
  if (data.length < 2) return null;

  const svgStyle = { height };
  const width = 400;
  const pad = { top: 6, bottom: 6, left: 0, right: 0 };

  const first = data[0]!;
  const last = data[data.length - 1]!;
  const minT = first.timestamp;
  const maxT = last.timestamp;
  const maxWpm = Math.max(...data.map(d => d.wpm), 10);

  const toX = (ts: number) => pad.left + ((ts - minT) / (maxT - minT || 1)) * (width - pad.left - pad.right);
  const toY = (wpm: number) => pad.top + (1 - wpm / maxWpm) * (height - pad.top - pad.bottom);

  const points = data.map(d => ({ x: toX(d.timestamp), y: toY(d.wpm) }));

  const pathD = points.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x},${p.y}`;
    const prev = points[i - 1]!;
    const cpX = (prev.x + p.x) / 2;
    return `${acc} C ${cpX},${prev.y} ${cpX},${p.y} ${p.x},${p.y}`;
  }, "");

  const lastPoint = points[points.length - 1]!;
  const firstPoint = points[0]!;
  const fillD = `${pathD} L ${lastPoint.x},${height} L ${firstPoint.x},${height} Z`;

  const peakWpm = Math.max(...data.map(d => d.wpm));
  const displayAvg = avgWpm ?? Math.round(data.reduce((s, d) => s + d.wpm, 0) / data.length);
  const peakIdx = data.findIndex(d => d.wpm === peakWpm);
  const peakPoint = peakIdx >= 0 ? points[peakIdx] : null;

  return (
    <div className="w-full space-y-2">
      <div className="flex justify-between text-label font-mono text-text-main/40 uppercase tracking-wider">
        <span>{t('wpm_peak')} {peakWpm} {t('wpm_unit')}</span>
        <span>{t('wpm_avg')} {displayAvg} {t('wpm_unit')}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={svgStyle} aria-hidden="true">
        <defs>
          <linearGradient id="wpm-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--flow-pulse-color)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--flow-pulse-color)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={fillD}
          fill="url(#wpm-fill)"
          initial={reducedMotion ? {} : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6 }}
        />
        <motion.path
          d={pathD}
          fill="none"
          stroke="var(--flow-pulse-color)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reducedMotion ? {} : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.2, ease: 'easeOut', delay: 0.1 }}
        />
        {peakPoint && (
          <>
            <motion.circle
              cx={peakPoint.x}
              cy={peakPoint.y}
              r="3"
              fill="var(--flow-pulse-color)"
              initial={reducedMotion ? {} : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 1.1 }}
            />
            <motion.g
              initial={reducedMotion ? {} : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 1.3 }}
            >
              <rect
                x={peakPoint.x > width * 0.75 ? peakPoint.x - 46 : peakPoint.x + 6}
                y={peakPoint.y - 22}
                width={40}
                height={18}
                rx={4}
                fill="var(--surface-elevated)"
                stroke="var(--border-light)"
                strokeWidth={0.5}
              />
              <text
                x={peakPoint.x > width * 0.75 ? peakPoint.x - 26 : peakPoint.x + 26}
                y={peakPoint.y - 9}
                textAnchor="middle"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
                fill="var(--flow-pulse-color)"
                fontWeight="500"
              >
                {peakWpm} wpm
              </text>
            </motion.g>
          </>
        )}
      </svg>
    </div>
  );
}
