// LB-1, стресс: случайные чередования правок двух устройств, разовых проходов и
// потерянных ответов. Инвариант после каждой волны: не удалённая метка не пропала,
// удалённая не вернулась, успех ⇒ есть в облаке, у каждой метки в облаке —
// последние подтверждённые имя и цвет; имена зашифрованы ровно один раз.
// Устройства — два настоящих хука над одним облаком, сталкиваются настоящей
// условной записью. Проходы — настоящие migrateUnencryptedLabels и
// repairDoubleEncryptedLabels со снимком на начало волны (уже устаревшим к записи).
// «Старый клиент» между волнами дописывает открытую или дважды зашифрованную метку.
// Сиды фиксируют выбор правок; порядок ответов внутри волны — от задержек и
// настоящей криптографии.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, act, waitFor } from '@testing-library/react';
import { cloud } from './labelCloud';
import { useProfileLabels } from '../useProfileLabels';
import { generateDataKey } from '../../../../core/crypto/encrypt';
import { decryptLabels, encryptLabels, migrateUnencryptedLabels, repairDoubleEncryptedLabels } from '../../../../core/crypto/labelEncryption';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { setProfileLoaded, setEncryptionEnabled } from '../../../../core/crypto/cryptoHelpers';

const UID = 'user_lb1_stress';

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'user_lb1_stress' }) }));
vi.mock('../../../../core/supabase/client', async () => {
  const { cloud: fake } = await import('./labelCloud');
  return { getSupabase: () => fake.client };
});
vi.mock('../../../../shared/errors/reportError', async (orig) => ({
  ...(await orig<typeof import('../../../../shared/errors/reportError')>()),
  reportError: vi.fn(),
}));

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WAVES = 14;
const COLORS = ['#111111', '#222222', '#333333', '#444444'];
type Raw = Record<string, unknown>;

beforeEach(async () => {
  cloud.reset();
  localStorage.clear();
  useEncryptionStore.getState().setKey(await generateDataKey());
  setProfileLoaded(UID, true);
  setEncryptionEnabled(UID, true);
});

describe('LB-1: стресс двух устройств и разовых проходов', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('сид %i: ни одна метка не потеряна, не воскресла и не откатилась', async (seed) => {
    const rnd = mulberry32(seed);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    cloud.put(UID, { uid: UID, labels: [] });
    const devices = [renderHook(() => useProfileLabels(UID)), renderHook(() => useProfileLabels(UID))];
    await waitFor(() => expect(cloud.calls.read).toBe(2));
    await act(async () => { await cloud.idle(); });
    // Свой генератор у задержек: выбор правок по сиду один и тот же в любом прогоне.
    const lag = mulberry32(seed + 1000);
    cloud.setJitter(() => new Promise(r => setTimeout(r, Math.floor(lag() * 3))));

    // id → последние подтверждённые имя и цвет; removed — удалённые успешно.
    const live = new Map<string, { name: string; color: string }>();
    const removed = new Set<string>();
    let n = 0;
    let lostAcks = 0;
    const append = (label: Raw) => {
      const row = cloud.rows.get(UID)!;
      cloud.put(UID, { ...row, labels: [...(row.labels as Raw[]), label] });
    };

    for (let wave = 0; wave < WAVES; wave++) {
      // Старый клиент между волнами: открытая метка (работа миграции) или дважды
      // зашифрованная (работа починки).
      const legacy = rnd();
      if (legacy < 0.2) {
        const id = `legacy_${seed}_${n}`; const name = `старая${n++}`;
        append({ id, name, color: COLORS[0] });
        live.set(id, { name, color: COLORS[0]! });
      } else if (legacy < 0.35) {
        const id = `double_${seed}_${n}`; const name = `двойная${n++}`;
        const [once] = await encryptLabels([{ id, name, color: COLORS[0]! }], UID);
        const [twice] = await encryptLabels([{ id, name: once!.name, color: COLORS[0]! }], UID);
        append(twice as unknown as Raw);
        live.set(id, { name, color: COLORS[0]! });
      }
      const snapshot = JSON.parse(JSON.stringify(cloud.labels(UID))) as Raw[];
      // Одну метку в волне трогает одна правка: иначе «последнее подтверждённое» не определено.
      const free = [...live.keys()];
      const take = () => free.splice(Math.floor(rnd() * free.length), 1)[0]!;
      const added: Array<{ name: string; color: string }> = [];
      const ops: Array<() => Promise<void>> = [];
      const size = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < size; i++) {
        const device = pick(devices).result;
        const roll = rnd();
        // Ответ на одну из записей волны теряется: запись прошла, клиент получил обрыв.
        if (rnd() < 0.15) { cloud.failNext('ack', new Error('network')); lostAcks++; }
        if (roll < 0.12) {
          ops.push(async () => { await migrateUnencryptedLabels(UID, snapshot); });
        } else if (roll < 0.24) {
          ops.push(async () => { await repairDoubleEncryptedLabels(UID, snapshot); });
        } else if (roll < 0.55 || free.length === 0) {
          const label = { name: `метка${n++}`, color: pick(COLORS) };
          added.push(label);
          ops.push(async () => { expect(await device.current.addLabel(label), `добавление ${label.name}`).toBe(true); });
        } else if (roll < 0.7) {
          const id = take();
          ops.push(async () => {
            expect(await device.current.removeLabel(id), `удаление ${id}`).toBe(true);
            removed.add(id); live.delete(id);
          });
        } else {
          const id = take();
          const was = live.get(id)!;
          const kind = pick(['name', 'color', 'both'] as const);
          const updates: { name?: string; color?: string } = {};
          if (kind !== 'color') updates.name = `метка${n++}`;
          if (kind !== 'name') updates.color = pick(COLORS.filter(c => c !== was.color));
          ops.push(async () => {
            expect(await device.current.updateLabel(id, updates), `правка ${id}`).toBe(true);
            live.set(id, { name: updates.name ?? was.name, color: updates.color ?? was.color });
          });
        }
      }
      await act(async () => { await Promise.all(ops.map(op => op())); await cloud.idle(); });

      const now = await decryptLabels(cloud.labels(UID));
      for (const label of added) {
        const hits = now.filter(l => l.name === label.name);
        expect(hits.length, `волна ${wave}: добавленная ${label.name} в облаке ровно одна`).toBe(1);
        live.set(hits[0]!.id, label);
      }
      // Дважды зашифрованная до починки расшифровывается в шифротекст — имя сверяем после неё (в конце).
      for (const [id, want] of live) {
        const got = now.find(l => l.id === id);
        expect(got, `волна ${wave}: метка ${id} пропала`).toBeDefined();
        expect(got!.color, `волна ${wave}: цвет ${id}`).toBe(want.color);
        if (!id.startsWith('double_')) expect(got!.name, `волна ${wave}: имя ${id}`).toBe(want.name);
      }
      for (const id of removed) expect(now.some(l => l.id === id), `волна ${wave}: удалённая ${id} вернулась`).toBe(false);
      expect(now.length, `волна ${wave}: лишние метки`).toBe(live.size);
    }

    cloud.setJitter(null);
    await repairDoubleEncryptedLabels(UID, cloud.labels(UID));
    await migrateUnencryptedLabels(UID, cloud.labels(UID));
    const raw = cloud.labels(UID);
    expect(raw.every(l => l._encrypted === true)).toBe(true);
    const final = await decryptLabels(raw);
    expect(Object.fromEntries(final.map(l => [l.id, { name: l.name, color: l.color }]))).toEqual(Object.fromEntries(live));
    expect(cloud.calls.write, 'прогон не пустой').toBeGreaterThan(WAVES);
    expect(lostAcks + seed, 'потерянные ответы были').toBeGreaterThan(seed);
  }, 30_000);
});
