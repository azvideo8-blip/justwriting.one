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
});
