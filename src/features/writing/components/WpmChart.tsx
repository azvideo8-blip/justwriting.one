import React from "react";
import { useLanguage } from "../../../core/i18n";

interface WpmChartProps {
  data: { timestamp: number; wpm: number }[];
  avgWpm?: number;
  height?: number;
}

export function WpmChart({ data, avgWpm, height = 72 }: WpmChartProps) {
  const { t } = useLanguage();
  if (data.length < 2) return null;

  const width = 400;
  const pad = { top: 6, bottom: 6, left: 0, right: 0 };

  const minT = data[0].timestamp;
  const maxT = data[data.length - 1].timestamp;
  const maxWpm = Math.max(...data.map(d => d.wpm), 10);

  const toX = (t: number) => pad.left + ((t - minT) / (maxT - minT || 1)) * (width - pad.left - pad.right);
  const toY = (wpm: number) => pad.top + (1 - wpm / maxWpm) * (height - pad.top - pad.bottom);

  const points = data.map(d => ({ x: toX(d.timestamp), y: toY(d.wpm) }));

  // Smooth polyline via cubic bezier
  const pathD = points.reduce((acc, p, i) => {
    if (i === 0) return "M " + p.x + "," + p.y;
    const prev = points[i - 1];
    const cpX = (prev.x + p.x) / 2;
    return acc + " C " + cpX + "," + prev.y + " " + cpX + "," + p.y + " " + p.x + "," + p.y;
  }, "");

  const fillD = pathD + " L " + points[points.length - 1].x + "," + height + " L " + points[0].x + "," + height + " Z";

  const peakWpm = Math.max(...data.map(d => d.wpm));
  const displayAvg = avgWpm ?? Math.round(data.reduce((s, d) => s + d.wpm, 0) / data.length);
  const peakIdx = data.findIndex(d => d.wpm === peakWpm);
  const peakPoint = points[peakIdx];

  return React.createElement("div", { className: "w-full space-y-2" },
    React.createElement("div", { className: "flex justify-between text-[10px] font-mono text-text-main/35 uppercase tracking-wider" },
      React.createElement("span", null, t('wpm_peak') + " " + peakWpm + " " + t('wpm_unit')),
      React.createElement("span", null, t('wpm_avg') + " " + displayAvg + " " + t('wpm_unit'))
    ),
    React.createElement("svg", { viewBox: "0 0 " + width + " " + height, preserveAspectRatio: "none", className: "w-full", style: { height }, "aria-hidden": true },
      React.createElement("defs", null,
        React.createElement("linearGradient", { id: "wpm-fill", x1: "0", y1: "0", x2: "0", y2: "1" },
          React.createElement("stop", { offset: "0%", stopColor: "var(--brand-soft)", stopOpacity: "0.25" }),
          React.createElement("stop", { offset: "100%", stopColor: "var(--brand-soft)", stopOpacity: "0" })
        )
      ),
      React.createElement("path", { d: fillD, fill: "url(#wpm-fill)" }),
      React.createElement("path", { d: pathD, fill: "none", stroke: "var(--brand-soft)", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }),
      peakPoint && React.createElement("circle", { cx: peakPoint.x, cy: peakPoint.y, r: "3", fill: "var(--brand-primary)" })
    )
  );
}
