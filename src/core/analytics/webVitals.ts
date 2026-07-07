import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { getPosthog, hasConsent } from './analytics';

const THRESHOLDS: Record<string, number> = {
  CLS: 0.1,
  FCP: 1800,
  INP: 200,
  LCP: 2500,
  TTFB: 600,
};

function sendToAnalytics(metric: Metric) {
  const threshold = THRESHOLDS[metric.name] ?? Infinity;
  const isSlow = metric.value > threshold;

  // PostHog
  if (hasConsent()) {
    getPosthog().then(ph => {
      ph.capture('web_vital', {
        metric_name: metric.name,
        metric_value: Math.round(metric.value * 1000) / 1000,
        metric_id: metric.id,
        metric_rating: metric.rating,
        metric_delta: Math.round(metric.delta * 1000) / 1000,
        is_slow: isSlow,
      });
    }).catch(console.error);
  }

  // Log slow metrics in development
  if (import.meta.env.DEV && isSlow) {
    console.warn(`[Web Vitals] Slow ${metric.name}: ${metric.value.toFixed(2)} (threshold: ${threshold})`);
  }
}

export function initWebVitals() {
  if (import.meta.env.DEV) return;

  onCLS(sendToAnalytics);
  onFCP(sendToAnalytics);
  onINP(sendToAnalytics);
  onLCP(sendToAnalytics);
  onTTFB(sendToAnalytics);
}
