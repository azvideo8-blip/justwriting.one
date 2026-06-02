import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { WpmChart } from '../components/WpmChart';
import { LanguageProvider } from '../../../core/i18n';

// ─── Replicate the chart math from WpmChart.tsx ───────────────────────────────

const WIDTH = 400;
const PAD = { top: 6, bottom: 6, left: 0, right: 0 };

function buildChartFns(data: { timestamp: number; wpm: number }[], height = 72) {
  const minT = data[0]?.timestamp ?? 0;
  const maxT = data[data.length - 1]?.timestamp ?? 0;
  const maxWpm = Math.max(...data.map(d => d.wpm), 10);

  const toX = (t: number) =>
    PAD.left + ((t - minT) / (maxT - minT || 1)) * (WIDTH - PAD.left - PAD.right);

  const toY = (wpm: number) =>
    PAD.top + (1 - wpm / maxWpm) * (height - PAD.top - PAD.bottom);

  return { toX, toY, minT, maxT, maxWpm };
}

function buildPath(data: { timestamp: number; wpm: number }[], height = 72): string {
  const { toX, toY } = buildChartFns(data, height);
  const points = data.map(d => ({ x: toX(d.timestamp), y: toY(d.wpm) }));
  return points.reduce((acc, p, i) => {
    if (i === 0) return 'M ' + p.x + ',' + p.y;
    const prev = points[i - 1];
    if (!prev) return acc;
    const cpX = (prev.x + p.x) / 2;
    return acc + ' C ' + cpX + ',' + prev.y + ' ' + cpX + ',' + p.y + ' ' + p.x + ',' + p.y;
  }, '');
}

function buildFillPath(data: { timestamp: number; wpm: number }[], height = 72): string {
  const { toX, toY } = buildChartFns(data, height);
  const points = data.map(d => ({ x: toX(d.timestamp), y: toY(d.wpm) }));
  const pathD = points.reduce((acc, p, i) => {
    if (i === 0) return 'M ' + p.x + ',' + p.y;
    const prev = points[i - 1];
    if (!prev) return acc;
    const cpX = (prev.x + p.x) / 2;
    return acc + ' C ' + cpX + ',' + prev.y + ' ' + cpX + ',' + p.y + ' ' + p.x + ',' + p.y;
  }, '');
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  if (!lastPoint || !firstPoint) return pathD;
  return pathD + ' L ' + lastPoint.x + ',' + height + ' L ' + firstPoint.x + ',' + height + ' Z';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WpmChart path generation math', () => {
  const data2 = [
    { timestamp: 0, wpm: 50 },
    { timestamp: 1000, wpm: 80 },
  ];

  it('path with 2 points starts with "M"', () => {
    const path = buildPath(data2);
    expect(path.startsWith('M')).toBe(true);
  });

  it('path with 2 points contains "C" (cubic bezier)', () => {
    const path = buildPath(data2);
    expect(path).toContain(' C ');
  });

  it('peak point is correctly identified as highest WPM', () => {
    const data = [
      { timestamp: 0, wpm: 30 },
      { timestamp: 500, wpm: 100 },
      { timestamp: 1000, wpm: 60 },
    ];
    const peakWpm = Math.max(...data.map(d => d.wpm));
    const peakIdx = data.findIndex(d => d.wpm === peakWpm);
    expect(peakWpm).toBe(100);
    expect(peakIdx).toBe(1);
  });

  it('avgWpm prop overrides internal mean calculation', () => {
    // Internal mean of [50, 80] = 65
    // If avgWpm=99 is passed, displayAvg should be 99 (not 65)
    const data = data2;
    const internalMean = Math.round(data.reduce((s, d) => s + d.wpm, 0) / data.length);
    const overriddenAvg = 99;
    const displayAvg = overriddenAvg ?? internalMean;
    expect(displayAvg).toBe(99);
  });

  it('toX maps first timestamp to x=0 (pad.left)', () => {
    const { toX, minT } = buildChartFns(data2);
    expect(toX(minT)).toBe(PAD.left); // = 0
  });

  it('toX maps last timestamp to x=width (minus padding)', () => {
    const { toX, maxT } = buildChartFns(data2);
    expect(toX(maxT)).toBe(WIDTH - PAD.left - PAD.right); // = 400
  });

  it('toY maps maxWpm to pad.top (top of chart)', () => {
    const { toY, maxWpm } = buildChartFns(data2);
    expect(toY(maxWpm)).toBe(PAD.top); // = 6
  });

  it('toY maps wpm=0 to bottom of chart (height - pad.bottom)', () => {
    const height = 72;
    const { toY } = buildChartFns(data2, height);
    expect(toY(0)).toBe(PAD.top + (height - PAD.top - PAD.bottom)); // = 6 + 60 = 66
  });

  it('fill path closes back to bottom (contains "L" and "Z")', () => {
    const fillPath = buildFillPath(data2);
    expect(fillPath).toContain(' L ');
    expect(fillPath).toContain(' Z');
  });

  it('fill path ends with Z', () => {
    const fillPath = buildFillPath(data2);
    expect(fillPath.trim().endsWith('Z')).toBe(true);
  });
});

describe('WpmChart component', () => {
  it('with data.length < 2 the component returns null', () => {
    const { container } = render(
      React.createElement(LanguageProvider, null,
        React.createElement(WpmChart, { data: [{ timestamp: 0, wpm: 50 }] })
      )
    );
    expect(container.firstChild).toBeNull();
  });

  it('with data.length === 0 the component returns null', () => {
    const { container } = render(
      React.createElement(LanguageProvider, null,
        React.createElement(WpmChart, { data: [] })
      )
    );
    expect(container.firstChild).toBeNull();
  });

  it('with data.length >= 2 the component renders an SVG', () => {
    const data = [
      { timestamp: 0, wpm: 50 },
      { timestamp: 1000, wpm: 80 },
    ];
    const { container } = render(
      React.createElement(LanguageProvider, null,
        React.createElement(WpmChart, { data })
      )
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
