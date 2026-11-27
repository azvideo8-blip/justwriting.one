// LB-1: чтение и условная запись меток на уровне провайдера — настоящий supabase-js,
// перехвачен fetch. Адрес запроса nginx пишет в журнал доступа и режет по длине,
// поэтому в нём не должно быть ни имён меток (открытых или шифротекста), ни
// зависимости от числа меток. Что PostgREST отдаёт xmin и сравнивает по нему — стенд, отчёт LB-1.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getProfileLabels, replaceProfileLabels } from '../profiles';

const sent: Array<{ url: string; method: string; body: { labels: Array<Record<string, unknown>> } | null }> = [];
let answer: { status: number; body: unknown } = { status: 200, body: [{ uid: 'u1' }] };

beforeEach(() => {
  sent.length = 0;
  answer = { status: 200, body: [{ uid: 'u1' }] };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: decodeURIComponent(String(input)), method: String(init?.method), body: init?.body != null ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
  }));
});

const UID = '11111111-1111-4111-8111-111111111111';
const label = (i: number) => ({ id: `id-${i}`, name: `ШИФРОТЕКСТ+/=${i}`, color: '#7BA9F0', _encrypted: true });
const query = (i = 0) => sent[i]!.url.split('?')[1]!.split('&').sort();

describe('replaceProfileLabels: условие записи', () => {
  it('условие — uid и версия строки; список едет в теле; в адресе нет ни имени, ни шифротекста', async () => {
    const next = [label(0), { id: 'id-1', name: 'Открытое имя', color: '#111' }];
    expect(await replaceProfileLabels(UID, '4711', next)).toBe(true);
    expect(sent[0]!.method).toBe('PATCH');
    expect(query()).toEqual(['select=uid', `uid=eq.${UID}`, 'xmin=eq.4711']);
    expect(sent[0]!.url).not.toMatch(/ШИФРОТЕКСТ|Открытое|имя|id-0/);
    expect(sent[0]!.body).toEqual({ labels: next });
  });

  it('200 меток: адрес той же длины, что и для двух, и без имён', async () => {
    const many = Array.from({ length: 200 }, (_, i) => label(i));
    await replaceProfileLabels(UID, '4711', many);
    await replaceProfileLabels(UID, '4711', [label(0), label(1)]);
    await replaceProfileLabels(UID, '4711', []);
    for (const { url } of sent) {
      expect(url).not.toContain('ШИФРОТЕКСТ');
      expect(url.length).toBeLessThan(200);
    }
    expect(new Set(sent.map(s => s.url.length)).size).toBe(1);
    expect(sent[0]!.body!.labels.length).toBe(200);
  });

  it('ноль строк (строку с тех пор записали или её нет) — false, не «сохранено»', async () => {
    answer = { status: 200, body: [] };
    expect(await replaceProfileLabels(UID, '4711', [])).toBe(false);
  });

  it('ошибка сервера — бросок, а не false: «не записали» ≠ «строку записали»', async () => {
    answer = { status: 429, body: { message: 'rate limited' } };
    await expect(replaceProfileLabels(UID, '4711', [])).rejects.toMatchObject({ message: 'rate limited' });
  });
});

describe('getProfileLabels: список вместе с версией строки', () => {
  it('читает uid, labels и xmin своей строки; версия — строкой', async () => {
    answer = { status: 200, body: { uid: UID, labels: [label(0)], xmin: 4711 } };
    expect(await getProfileLabels(UID)).toEqual({ labels: [label(0)], version: '4711' });
    expect(sent[0]!.method).toBe('GET');
    expect(query()).toEqual(['select=uid,labels,xmin', `uid=eq.${UID}`]);
  });

  it('SQL null в колонке доходит как null (строка есть); строки нет — null целиком', async () => {
    answer = { status: 200, body: { uid: UID, labels: null, xmin: '4711' } };
    expect(await getProfileLabels(UID)).toEqual({ labels: null, version: '4711' });
    answer = { status: 200, body: null };
    expect(await getProfileLabels(UID)).toBeNull();
  });

  it('чужая строка не принимается', async () => {
    answer = { status: 200, body: { uid: '22222222-2222-4222-8222-222222222222', labels: [], xmin: '1' } };
    await expect(getProfileLabels(UID)).rejects.toThrow();
  });

  it('ошибка чтения — бросок', async () => {
    answer = { status: 500, body: { message: 'boom' } };
    await expect(getProfileLabels(UID)).rejects.toMatchObject({ message: 'boom' });
  });
});

// DA-4 (дейлик 27.11): строка есть, а xmin не пришёл — сбой чтения, а не версия
// "undefined", по которой условная запись не совпала бы никогда.
// Мутация: снять проверку xmin в getProfileLabels — красный.
describe('getProfileLabels: версия строки', () => {
  it('строка с xmin — версия строкой', async () => {
    answer = { status: 200, body: { uid: UID, labels: [], xmin: '4711' } };
    expect(await getProfileLabels(UID)).toEqual({ labels: [], version: '4711' });
  });

  it('строка без xmin — отказ, а не версия "undefined"', async () => {
    answer = { status: 200, body: { uid: UID, labels: [] } };
    await expect(getProfileLabels(UID)).rejects.toThrow('PROFILE_VERSION_MISSING');
  });
});
