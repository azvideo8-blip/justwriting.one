import { describe, it, expect } from 'vitest';
import { stripHash } from '../bundle-compare';

// Изменившийся чанк получает новый хэш. Пока сопоставление шло по полному
// имени, он не находил пару в базе, уходил в «новый», и порог к нему не
// применялся — оба гейта размера не срабатывали ни разу.
describe('stripHash', () => {
  it('matches the same chunk across two builds', () => {
    expect(stripHash('index-CSCSaN6_.js')).toBe(stripHash('index-Ab12Cd34.js'));
  });

  it('keeps different chunks apart', () => {
    expect(stripHash('index-CSCSaN6_.js')).not.toBe(stripHash('vendor-CSCSaN6_.js'));
  });

  it('keeps the extension', () => {
    expect(stripHash('index-CSCSaN6_.css')).toBe('index.css');
  });

  // AUDIT-part3 bundle-size: имя чанка может содержать дефисы (vendor-sentry,
  // vendor-chat-memory). Жадный класс [A-Za-z0-9_-]{8,} съедал имя целиком —
  // все vendor-чанки схлопывались в 'vendor.js' и парились с чужой базой.
  it('strips only the hash, keeping multi-hyphen chunk names', () => {
    expect(stripHash('vendor-sentry-Cdc_SYrQ.js')).toBe('vendor-sentry.js');
    expect(stripHash('vendor-analytics-DSv-zlP-.js')).toBe('vendor-analytics.js');
    expect(stripHash('vendor-chat-memory-Ab12Cd34.js')).toBe('vendor-chat-memory.js');
  });

  it('distinguishes two same-name chunks by size pairing, not by name collision', () => {
    // Два index-чанка в ОБОИХ сборках: паринг должен свести большой с большим.
    expect(stripHash('index-eLPTrxDb.js')).toBe(stripHash('index-SR31ZY_V.js'));
  });
});
