// LB-1: ни одна правка метки не теряет метку, которую не трогала, и не рапортует
// успех, которого нет в облаке. Настоящие useProfileLabels, ProfileService,
// labelEncryption и криптография; подменён край — облако (labelCloud.ts), вход,
// журнал. Имена меток выдуманы. Мутации к каждому тесту — в отчёте LB-1.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createElement, type ReactNode } from 'react';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import { cloud } from './labelCloud';
import { useProfileLabels } from '../useProfileLabels';
import { ProfileService } from '../../../../core/services/ProfileService';
import { ProfileProvider } from '../../../auth/contexts/ProfileContext';
import { useLabelEditor } from '../../../archive/hooks/useLabelEditor';
import { ToastProvider } from '../../../../shared/components/Toast';
import { LanguageProvider } from '../../../../shared/i18n';
import { generateDataKey } from '../../../../core/crypto/encrypt';
import { encryptLabels, decryptLabels, migrateUnencryptedLabels, repairDoubleEncryptedLabels } from '../../../../core/crypto/labelEncryption';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { setProfileLoaded, setEncryptionEnabled } from '../../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../../shared/errors/reportError';
import type { Label } from '../../../../types';

const UID = 'user_lb1';

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'user_lb1' }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }) }));
vi.mock('../../../auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'user_lb1', email: 'lb1@stand.test' } }) }));
vi.mock('../../../../core/supabase/client', async () => {
  const { cloud: fake } = await import('./labelCloud');
  return { getSupabase: () => fake.client };
});
vi.mock('../../../../shared/errors/reportError', async (orig) => ({
  ...(await orig<typeof import('../../../../shared/errors/reportError')>()),
  reportError: vi.fn(),
}));

let key: CryptoKey;
const C1 = '#111111';
const C2 = '#222222';

async function seed(names: string[]) {
  const plain = names.map((name, i) => ({ id: `l${i + 1}`, name, color: C1 }));
  cloud.put(UID, { uid: UID, labels: await encryptLabels(plain, UID) });
}
const cloudNames = async () => (await decryptLabels(cloud.labels(UID))).map(l => l.name);
const shown = (r: { current: { labels: Label[] } }) => r.current.labels.map(l => l.name);

type Raw = Record<string, unknown>;
/**
 * Другое устройство: запись целиком на сервере, между нашими чтением и записью.
 * Так же пишет и вкладка прежней версии (без условия) — версию строки меняет любая запись.
 */
function otherDevice(change: (labels: Raw[]) => Raw[]) {
  const row = cloud.rows.get(UID)!;
  cloud.put(UID, { ...row, labels: change(row.labels as Raw[]) });
}
async function otherDeviceAdds(name: string) {
  const [enc] = await encryptLabels([{ id: `other_${name}`, name, color: C1 }], UID);
  otherDevice(labels => [...labels, enc as unknown as Raw]);
}
function otherDeviceRemoves(id: string) {
  otherDevice(labels => labels.filter(l => l.id !== id));
}
/** Запускает правку, дожидается её записи в пути, вклинивает чужую запись и отпускает. */
async function withWriteBetween(edit: () => Promise<boolean>, other: () => void | Promise<void>): Promise<boolean> {
  const writes = cloud.calls.write;
  const land = cloud.hold('write');
  let p!: Promise<boolean>;
  await act(async () => { p = edit(); await Promise.resolve(); });
  await waitFor(() => expect(cloud.calls.write).toBe(writes + 1));
  await other();
  let ok = false;
  await act(async () => { land(); ok = await p; });
  return ok;
}

async function mountLoaded(count: number, initial?: Label[]) {
  const h = renderHook(() => useProfileLabels(UID, initial));
  await waitFor(() => expect(h.result.current.labels.length).toBe(count));
  return h;
}

beforeEach(async () => {
  vi.mocked(reportError).mockClear();
  cloud.reset();
  localStorage.clear();
  key = await generateDataKey();
  useEncryptionStore.getState().setKey(key);
  setProfileLoaded(UID, true);
  setEncryptionEnabled(UID, true);
});

describe('LB-1: правка берёт список из облака, а не из экрана', () => {
  it('R2-I1a: добавили, пока грузится первый список; поздний ответ не возвращает старое', async () => {
    await seed(['Альфа']);
    const late = cloud.hold('read');
    const { result } = renderHook(() => useProfileLabels(UID));
    await waitFor(() => expect(cloud.calls.read).toBe(1));
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    await act(async () => { late(); await cloud.idle(); });
    expect(shown(result)).toEqual(['Альфа', 'Бета']);
    await act(async () => { expect(await result.current.addLabel({ name: 'Гамма', color: C1 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа', 'Бета', 'Гамма']);
    expect(shown(result)).toEqual(['Альфа', 'Бета', 'Гамма']);
  });

  it('R2-I1b: ответ чтения после ухода с экрана не становится базой следующей правки', async () => {
    await seed(['Альфа']);
    const late = cloud.hold('read');
    const first = renderHook(() => useProfileLabels(UID));
    await waitFor(() => expect(cloud.calls.read).toBe(1));
    first.unmount();
    await act(async () => { late(); await cloud.idle(); });
    await otherDeviceAdds('Дельта');
    const { result } = renderHook(() => useProfileLabels(UID));
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа', 'Дельта', 'Бета']);
  });

  it('R2-I1c: две правки подряд из одного замыкания — обе в облаке', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    const { addLabel } = result.current;
    let oks: boolean[] = [];
    await act(async () => {
      oks = await Promise.all([addLabel({ name: 'Бета', color: C1 }), addLabel({ name: 'Гамма', color: C1 })]);
    });
    expect(oks).toEqual([true, true]);
    expect((await cloudNames()).sort()).toEqual(['Альфа', 'Бета', 'Гамма']);
  });

  it('ответ на раннюю правку пришёл после поздней — экран сходится к облаку', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    const ack = cloud.hold('ack');
    let early!: Promise<boolean>;
    await act(async () => { early = result.current.addLabel({ name: 'Бета', color: C1 }); await Promise.resolve(); });
    await waitFor(() => expect(cloud.labels(UID).length).toBe(2)); // записано, ответ в пути
    await act(async () => { expect(await result.current.addLabel({ name: 'Гамма', color: C1 })).toBe(true); });
    await act(async () => { ack(); expect(await early).toBe(true); await cloud.idle(); });
    expect(await cloudNames()).toEqual(['Альфа', 'Бета', 'Гамма']);
    await waitFor(() => expect(shown(result)).toEqual(['Альфа', 'Бета', 'Гамма']));
  });

  it('R2-I1d: добавить, затем переименовать из старого замыкания — добавленная на месте', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    const old = result.current;
    await act(async () => { expect(await old.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    await act(async () => { expect(await old.updateLabel('l1', { name: 'Альфа2', color: C2 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа2', 'Бета']);
  });

  it('R2-I1d: добавить, затем удалить из старого замыкания — добавленная на месте', async () => {
    await seed(['Альфа', 'Эпсилон']);
    const { result } = await mountLoaded(2);
    const old = result.current;
    await act(async () => { expect(await old.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    await act(async () => { expect(await old.removeLabel('l1')).toBe(true); });
    expect(await cloudNames()).toEqual(['Эпсилон', 'Бета']);
  });

  it('LB-dev: другое устройство добавило метку между нашим чтением и записью', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    expect(await withWriteBetween(() => result.current.addLabel({ name: 'Бета', color: C1 }), () => otherDeviceAdds('Дельта'))).toBe(true);
    expect(await cloudNames()).toEqual(['Альфа', 'Дельта', 'Бета']);
    expect(shown(result)).toEqual(['Альфа', 'Дельта', 'Бета']);
  });

  it('LB-dev: тот же набор меток, другое устройство сменило цвет — наша запись его не откатывает', async () => {
    await seed(['Альфа', 'Эпсилон']);
    const { result } = await mountLoaded(2);
    const recolor = () => otherDevice(labels => labels.map(l => l.id === 'l2' ? { ...l, color: C2 } : l));
    expect(await withWriteBetween(() => result.current.addLabel({ name: 'Бета', color: C1 }), recolor)).toBe(true);
    expect(cloud.labels(UID)[1]!.color).toBe(C2);
    expect(await cloudNames()).toEqual(['Альфа', 'Эпсилон', 'Бета']);
  });

  it('LB-dev: запись в другую колонку строки (не метки) тоже заставляет перечитать — метки целы', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    const touch = () => cloud.put(UID, { ...cloud.rows.get(UID)!, nickname: 'Выдуманный' });
    expect(await withWriteBetween(() => result.current.addLabel({ name: 'Бета', color: C1 }), touch)).toBe(true);
    expect(await cloudNames()).toEqual(['Альфа', 'Бета']);
    expect(cloud.rows.get(UID)!.nickname).toBe('Выдуманный');
  });

  it('формат списка прежний: в облаке у метки только id, name, color, _encrypted', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    for (const l of cloud.labels(UID)) expect(Object.keys(l).sort()).toEqual(['_encrypted', 'color', 'id', 'name']);
  });

  it('две первые метки разом в пустой список — обе на месте', async () => {
    cloud.put(UID, { uid: UID, labels: [] });
    const { result } = renderHook(() => useProfileLabels(UID));
    await act(async () => { await cloud.idle(); });
    expect(await withWriteBetween(() => result.current.addLabel({ name: 'Бета', color: C1 }), () => otherDeviceAdds('Дельта'))).toBe(true);
    expect(await cloudNames()).toEqual(['Дельта', 'Бета']);
  });

  it('метку удалили на другом устройстве — переименование отказано и не воскрешает её', async () => {
    await seed(['Альфа', 'Эпсилон']);
    const { result } = await mountLoaded(2);
    otherDeviceRemoves('l1');
    await act(async () => { expect(await result.current.updateLabel('l1', { name: 'Альфа2', color: C2 })).toBe(false); });
    expect(await cloudNames()).toEqual(['Эпсилон']);
  });
});

describe('LB-1: разовые проходы не пишут поверх свежего списка', () => {
  it('R3-I2: шифрование старой открытой метки не стирает метку, добавленную следом', async () => {
    cloud.put(UID, { uid: UID, labels: [{ id: 'l1', name: 'Старая', color: C1 }] });
    const landMigration = cloud.hold('write');
    const { result } = await mountLoaded(1);
    await waitFor(() => expect(cloud.calls.write).toBe(1)); // запись прохода в пути
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    await act(async () => { landMigration(); await cloud.idle(); });
    expect(await cloudNames()).toEqual(['Старая', 'Бета']);

    // Проход жив: следующее чтение шифрует открытую метку.
    await ProfileService.getProfile(UID);
    await vi.waitFor(() => expect(cloud.labels(UID).every(l => l._encrypted === true)).toBe(true));
    expect(await cloudNames()).toEqual(['Старая', 'Бета']);
    expect(JSON.stringify(cloud.labels(UID))).not.toContain('Старая');
  });
});

describe('LB-1: починка двойного шифрования не пишет поверх свежего списка', () => {
  it('R3-I2 (второй проход): починка не стирает метку, добавленную следом', async () => {
    const [once] = await encryptLabels([{ id: 'l1', name: 'Двойная', color: C1 }], UID);
    const [twice] = await encryptLabels([{ id: 'l1', name: once!.name, color: C1 }], UID);
    cloud.put(UID, { uid: UID, labels: [twice] });
    const landRepair = cloud.hold('write');
    const { result } = await mountLoaded(1);
    await waitFor(() => expect(cloud.calls.write).toBe(1)); // запись прохода в пути
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    await act(async () => { landRepair(); await cloud.idle(); });
    expect(cloud.labels(UID).length).toBe(2);

    await ProfileService.getProfile(UID);
    await vi.waitFor(async () => expect(await cloudNames()).toEqual(['Двойная', 'Бета']));
  });
});

describe('LB-1: разовый проход из контекста профиля', () => {
  it('снимок профиля (ProfileProvider) шифрует открытую метку', async () => {
    cloud.put(UID, { uid: UID, labels: [{ id: 'l1', name: 'Старая', color: C1 }] });
    render(createElement(ProfileProvider, null));
    await vi.waitFor(() => expect(cloud.labels(UID)[0]!._encrypted).toBe(true));
    expect(await cloudNames()).toEqual(['Старая']);
  });

  it('проход пишет от свежего чтения: список вызывающего устарел — свежая метка на месте', async () => {
    const stale = [{ id: 'l1', name: 'Старая', color: C1 }];
    cloud.put(UID, { uid: UID, labels: stale });
    await otherDeviceAdds('Дельта');
    expect(await migrateUnencryptedLabels(UID, stale)).toBe(true);
    expect(cloud.labels(UID).every(l => l._encrypted === true)).toBe(true);
    expect(await cloudNames()).toEqual(['Старая', 'Дельта']);
  });

  it('здоровый список не стоит проходам ни одного запроса', async () => {
    await seed(['Альфа']);
    expect(await migrateUnencryptedLabels(UID, cloud.labels(UID))).toBe(false);
    expect(await repairDoubleEncryptedLabels(UID, cloud.labels(UID))).toBe(false);
    expect(cloud.calls).toEqual({ read: 0, write: 0 });
  });
});

describe('LB-1: «не прочитано» — не «пусто»; успех только когда запись в облаке', () => {
  it('R3-N2: строки профиля нет — отказ, одна попытка чтения, записи нет', async () => {
    const { result } = renderHook(() => useProfileLabels(UID));
    await act(async () => { await cloud.idle(); });
    const reads = cloud.calls.read;
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(false); });
    expect(cloud.rows.has(UID)).toBe(false);
    expect(cloud.calls).toEqual({ read: reads + 1, write: 0 });
  });

  it('поле меток — не список: отказ, поле не тронуто', async () => {
    cloud.put(UID, { uid: UID, labels: 'мусор' });
    const { result } = renderHook(() => useProfileLabels(UID));
    await act(async () => { await cloud.idle(); });
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(false); });
    expect(cloud.rows.get(UID)!.labels).toBe('мусор');
    expect(cloud.calls.write).toBe(0);
  });

  it('поле меток — SQL null: строка есть, меток нет — добавление проходит', async () => {
    cloud.put(UID, { uid: UID, labels: null });
    const { result } = renderHook(() => useProfileLabels(UID));
    await act(async () => { await cloud.idle(); });
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Бета']);
  });

  it('чтение отказало (429) — правка отказана, облако не тронуто', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    cloud.failNext('read', new Error('429'));
    await act(async () => { expect(await result.current.removeLabel('l1')).toBe(false); });
    expect(await cloudNames()).toEqual(['Альфа']);
    expect(cloud.calls.write).toBe(0);
  });

  it('R3-N1: запись отказала — список на экране прежний, повтор проходит', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    cloud.failNext('write', new Error('429'));
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(false); });
    expect(shown(result)).toEqual(['Альфа']);
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа', 'Бета']);
  });

  it('R3-N3: зависшее чтение одной правки не держит следующие', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    const unhang = cloud.hold('read');
    let hung!: Promise<boolean>;
    await act(async () => { hung = result.current.addLabel({ name: 'Бета', color: C1 }); await Promise.resolve(); });
    await act(async () => { expect(await result.current.addLabel({ name: 'Гамма', color: C1 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа', 'Гамма']);
    await act(async () => { unhang(); expect(await hung).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа', 'Гамма', 'Бета']);
  });

  it('последняя метка удалена — устаревший список из контекста её не возвращает на экран', async () => {
    await seed(['Альфа']);
    const fromContext: Label[] = [{ id: 'l1', name: 'Альфа', color: C1 }];
    const { result } = await mountLoaded(1, fromContext);
    await waitFor(() => expect(cloud.calls.read).toBe(1));
    await act(async () => { await cloud.idle(); });
    await act(async () => { expect(await result.current.removeLabel('l1')).toBe(true); });
    await act(async () => { await cloud.idle(); });
    expect(result.current.labels).toEqual([]);
    expect(cloud.labels(UID)).toEqual([]);
  });
});

describe('LB-1: сейф заперт', () => {
  async function mountLocked() {
    await seed(['Альфа', 'Эпсилон']);
    useEncryptionStore.getState().lockVault();
    const h = await mountLoaded(2);
    expect(h.result.current.labels.every(l => l._undecrypted)).toBe(true);
    return h;
  }

  it('R3-I1: переименование заглушки отказано, шифротекст в облаке прежний', async () => {
    const { result } = await mountLocked();
    const before = JSON.stringify(cloud.labels(UID));
    await act(async () => { expect(await result.current.updateLabel('l1', { name: 'Новое', color: C2 })).toBe(false); });
    expect(JSON.stringify(cloud.labels(UID))).toBe(before);
    expect(JSON.stringify(vi.mocked(reportError).mock.calls)).not.toContain('Новое');
  });

  it('смена цвета заглушки проходит, имя в облаке не тронуто', async () => {
    const { result } = await mountLocked();
    const cipher = cloud.labels(UID)[0]!.name;
    await act(async () => { expect(await result.current.updateLabel('l1', { color: C2 })).toBe(true); });
    expect(cloud.labels(UID)[0]).toEqual({ id: 'l1', name: cipher, color: C2, _encrypted: true });
    useEncryptionStore.getState().setKey(key);
    expect(await cloudNames()).toEqual(['Альфа', 'Эпсилон']);
  });

  it('добавление отказано, открытый текст не ушёл ни в облако, ни в журнал', async () => {
    const { result } = await mountLocked();
    const before = JSON.stringify(cloud.labels(UID));
    await act(async () => { expect(await result.current.addLabel({ name: 'Тайное', color: C1 })).toBe(false); });
    expect(JSON.stringify(cloud.labels(UID))).toBe(before);
    expect(cloud.calls.write).toBe(0);
    expect(JSON.stringify(vi.mocked(reportError).mock.calls)).not.toContain('Тайное');
  });

  it('удаление проходит, остальные шифротексты прежние', async () => {
    const { result } = await mountLocked();
    const kept = JSON.stringify(cloud.labels(UID)[1]);
    await act(async () => { expect(await result.current.removeLabel('l1')).toBe(true); });
    expect(JSON.stringify(cloud.labels(UID))).toBe(`[${kept}]`);
  });
});

describe('LB-1: список из контекста профиля на экране', () => {
  it('контекст отдал метки раньше своего чтения — они показаны', async () => {
    await seed(['Альфа']);
    cloud.hold('read');
    const { result, rerender } = renderHook(({ initial }: { initial: Label[] }) => useProfileLabels(UID, initial), { initialProps: { initial: [] as Label[] } });
    rerender({ initial: [{ id: 'l1', name: 'Альфа', color: C1 }] });
    expect(shown(result)).toEqual(['Альфа']);
  });

  it('своё чтение дало заглушки (сейф был заперт), контекст принёс имена — показаны имена', async () => {
    await seed(['Альфа']);
    useEncryptionStore.getState().lockVault();
    const { result, rerender } = renderHook(({ initial }: { initial: Label[] }) => useProfileLabels(UID, initial), { initialProps: { initial: [] as Label[] } });
    await waitFor(() => expect(shown(result)).toEqual(['…']));
    rerender({ initial: [{ id: 'l1', name: 'Альфа', color: C1 }] });
    expect(shown(result)).toEqual(['Альфа']);
  });
});

describe('LB-1: открытое имя не уходит в облако при включённом сейфе', () => {
  it('переименование без цвета оставляет цвет из облака', async () => {
    await seed(['Альфа']);
    const next = await ProfileService.editLabels(UID, { update: { id: 'l1', name: 'Альфа2' } });
    expect(next).toEqual([{ id: 'l1', name: 'Альфа2', color: C1 }]);
    expect(cloud.labels(UID)[0]!.color).toBe(C1);
  });

  it('добавление и переименование пишут шифротекст; нетронутая метка не перешифрована', async () => {
    await seed(['Альфа', 'Эпсилон']);
    const untouched = JSON.stringify(cloud.labels(UID)[1]);
    const { result } = await mountLoaded(2);
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    await act(async () => { expect(await result.current.updateLabel('l1', { name: 'Альфа2', color: C2 })).toBe(true); });
    const raw = cloud.labels(UID);
    expect(raw.every(l => l._encrypted === true)).toBe(true);
    for (const name of ['Альфа2', 'Бета', 'Эпсилон']) expect(JSON.stringify(raw)).not.toContain(name);
    expect(JSON.stringify(raw[1])).toBe(untouched);
    expect(await cloudNames()).toEqual(['Альфа2', 'Эпсилон', 'Бета']);
  });
});

describe('LB-1 / I-1: что изменилось, решает форма по значениям на момент открытия', () => {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
  const mountWithEditor = (initial?: Label[]) => renderHook(() => {
    const labels = useProfileLabels(UID, initial);
    return { labels, editor: useLabelEditor({ ...labels, labels: labels.labels }) };
  }, { wrapper });
  type Mounted = ReturnType<typeof mountWithEditor>['result'];
  const open = (r: Mounted, id: string) => act(() => {
    const label = r.current.labels.labels.find(l => l.id === id)!;
    r.current.editor.setEditingLabelId(id);
    r.current.editor.setEditLabelName(label.name);
    r.current.editor.setEditLabelColor(label.color);
  });
  const save = async (r: Mounted, id: string) => { await act(async () => { r.current.editor.handleUpdateLabel(id); await cloud.idle(); }); };

  it('форма открыта на «…» при запертом сейфе, сейф открыли, сохранили цвет — имя в облаке прежнее', async () => {
    await seed(['Альфа']);
    useEncryptionStore.getState().lockVault();
    const { result } = mountWithEditor();
    await waitFor(() => expect(result.current.labels.labels.map(l => l.name)).toEqual(['…']));
    open(result, 'l1');
    await act(async () => { useEncryptionStore.getState().setKey(key); await cloud.idle(); });
    await waitFor(() => expect(result.current.labels.labels[0]!.name).toBe('Альфа'));
    act(() => { result.current.editor.setEditLabelColor(C2); });
    await save(result, 'l1');
    // Ответ облака пришёл, но итог правки ещё расшифровывается — ждём саму форму.
    await waitFor(() => expect(result.current.editor.editingLabelId).toBeNull());
    expect(await cloudNames()).toEqual(['Альфа']);
    expect(cloud.labels(UID)[0]!.color).toBe(C2);
  });

  it('форма открыта на устаревшем имени, сохранили только цвет — переименование с другого устройства не откатилось', async () => {
    await seed(['Альфа']);
    const { result } = mountWithEditor();
    await waitFor(() => expect(result.current.labels.labels.length).toBe(1));
    open(result, 'l1');
    const [renamed] = await encryptLabels([{ id: 'l1', name: 'Альфа-новая', color: C1 }], UID);
    otherDevice(() => [renamed as unknown as Raw]);
    act(() => { result.current.editor.setEditLabelColor(C2); });
    await save(result, 'l1');
    expect(await cloudNames()).toEqual(['Альфа-новая']);
    expect(cloud.labels(UID)[0]!.color).toBe(C2);
  });

  it('сохранили только имя — цвет, сменённый на другом устройстве, не откатился', async () => {
    await seed(['Альфа']);
    const { result } = mountWithEditor();
    await waitFor(() => expect(result.current.labels.labels.length).toBe(1));
    open(result, 'l1');
    otherDevice(labels => labels.map(l => ({ ...l, color: C2 })));
    act(() => { result.current.editor.setEditLabelName('Альфа2'); });
    await save(result, 'l1');
    expect(await cloudNames()).toEqual(['Альфа2']);
    expect(cloud.labels(UID)[0]!.color).toBe(C2);
  });

  it('ничего не меняли — записи нет, форма закрыта', async () => {
    await seed(['Альфа']);
    const { result } = mountWithEditor();
    await waitFor(() => expect(result.current.labels.labels.length).toBe(1));
    open(result, 'l1');
    await save(result, 'l1');
    expect(cloud.calls.write).toBe(0);
    expect(result.current.editor.editingLabelId).toBeNull();
  });

  it('«…», набранное как имя, не сохраняется: записи нет, форма открыта', async () => {
    await seed(['Альфа']);
    const { result } = mountWithEditor();
    await waitFor(() => expect(result.current.labels.labels.length).toBe(1));
    open(result, 'l1');
    act(() => { result.current.editor.setEditLabelName('…'); });
    await save(result, 'l1');
    expect(cloud.calls.write).toBe(0);
    expect(result.current.editor.editingLabelId).toBe('l1');
    expect(await cloudNames()).toEqual(['Альфа']);
  });

  it('два нажатия «Сохранить» подряд в форме новой метки — одна метка', async () => {
    await seed(['Альфа']);
    const { result } = mountWithEditor();
    await waitFor(() => expect(result.current.labels.labels.length).toBe(1));
    act(() => { result.current.editor.setAddingLabel(true); result.current.editor.setNewLabelName('Бета'); });
    const writes = cloud.calls.write;
    await act(async () => { result.current.editor.handleAddLabel(); result.current.editor.handleAddLabel(); await cloud.idle(); });
    expect(await cloudNames()).toEqual(['Альфа', 'Бета']);
    expect(cloud.calls.write).toBe(writes + 1);
  });
});

describe('LB-1 / N-1: добавление и правка идемпотентны', () => {
  it('ответ на запись потерян — перечитали, метка в облаке: успех, одна метка', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    cloud.failNext('ack', new Error('network'));
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа', 'Бета']);
    expect(shown(result)).toEqual(['Альфа', 'Бета']);
  });

  it('ответ потерян и перечитать не удалось — отказ; повтор той же формы не создаёт вторую метку', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    cloud.failNext('ack', new Error('network'));
    cloud.failNext('read', new Error('network'), 1); // чтение перед записью проходит, перечитывание — нет
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(false); });
    expect(cloud.labels(UID).length).toBe(2); // запись на самом деле прошла
    const writes = cloud.calls.write;
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа', 'Бета']);
    expect(cloud.calls.write).toBe(writes); // уже в облаке — второй записи нет
  });

  it('одна и та же метка отправлена дважды разом (двойное нажатие мимо формы) — одна метка', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    const { addLabel } = result.current;
    let oks: boolean[] = [];
    await act(async () => { oks = await Promise.all([addLabel({ name: 'Бета', color: C1 }), addLabel({ name: 'Бета', color: C1 })]); });
    expect(oks).toEqual([true, true]);
    expect(await cloudNames()).toEqual(['Альфа', 'Бета']);
  });

  it('добавление «не удалось», но состоялось; метку переименовали — то же имя добавляется новой меткой', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    cloud.failNext('ack', new Error('network'));
    cloud.failNext('read', new Error('network'), 1);
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(false); });
    const id = cloud.labels(UID)[1]!.id as string;
    await act(async () => { expect(await result.current.updateLabel(id, { name: 'Гамма' })).toBe(true); });
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа', 'Гамма', 'Бета']);
  });

  it('после успеха та же пара имя+цвет — уже новая метка', async () => {
    await seed([]);
    cloud.put(UID, { uid: UID, labels: [] });
    const { result } = renderHook(() => useProfileLabels(UID));
    await act(async () => { await cloud.idle(); });
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    await act(async () => { expect(await result.current.addLabel({ name: 'Бета', color: C1 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Бета', 'Бета']);
  });

  it('переименование: ответ потерян — перечитали, имя уже новое: успех', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    cloud.failNext('ack', new Error('network'));
    await act(async () => { expect(await result.current.updateLabel('l1', { name: 'Альфа2', color: C2 })).toBe(true); });
    expect(await cloudNames()).toEqual(['Альфа2']);
    expect(cloud.calls.write).toBe(1);
  });

  it('смена цвета: ответ потерян — перечитали, цвет уже новый: успех', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    cloud.failNext('ack', new Error('network'));
    await act(async () => { expect(await result.current.updateLabel('l1', { color: C2 })).toBe(true); });
    expect(cloud.labels(UID)[0]!.color).toBe(C2);
  });

  it('переименование с цветом: запись не прошла, а имя в облаке уже такое (с другого устройства) — отказ, цвет не «сохранён»', async () => {
    await seed(['Альфа2']);
    const { result } = await mountLoaded(1);
    cloud.failNext('write', new Error('429'));
    await act(async () => { expect(await result.current.updateLabel('l1', { name: 'Альфа2', color: C2 })).toBe(false); });
    expect(cloud.labels(UID)[0]!.color).toBe(C1);
  });

  it('удаление: ответ потерян — перечитали, метки нет: успех', async () => {
    await seed(['Альфа', 'Эпсилон']);
    const { result } = await mountLoaded(2);
    cloud.failNext('ack', new Error('network'));
    await act(async () => { expect(await result.current.removeLabel('l1')).toBe(true); });
    expect(await cloudNames()).toEqual(['Эпсилон']);
  });
});

const FROM_CONTEXT: Label[] = [{ id: 'l1', name: 'Альфа', color: C1 }];

describe('LB-1 / N-2, N-5: экран', () => {
  it('чтение отказало — список из контекста остаётся, «не прочитано» не значит «меток нет»', async () => {
    await seed(['Альфа']);
    cloud.failNext('read', new Error('network'));
    const { result } = renderHook(() => useProfileLabels(UID, FROM_CONTEXT));
    await act(async () => { await cloud.idle(); });
    expect(cloud.calls.read).toBe(1);
    expect(shown(result)).toEqual(['Альфа']);
  });

  it('метку удалили на другом устройстве — правка отказана, и метка уходит с экрана', async () => {
    await seed(['Альфа', 'Эпсилон']);
    const { result } = await mountLoaded(2);
    otherDevice(labels => labels.filter(l => l.id !== 'l1'));
    await act(async () => { expect(await result.current.updateLabel('l1', { name: 'Альфа2' })).toBe(false); });
    await waitFor(() => expect(shown(result)).toEqual(['Эпсилон']));
    expect(await cloudNames()).toEqual(['Эпсилон']);
  });

  it('N-2: сейф заперли после загрузки, удалили метку — она не возвращается из списка контекста, имена берутся по id', async () => {
    await seed(['Альфа', 'Эпсилон']);
    const fromContext: Label[] = [{ id: 'l1', name: 'Альфа', color: C1 }, { id: 'l2', name: 'Эпсилон', color: C1 }];
    const { result } = await mountLoaded(2, fromContext);
    await act(async () => { await cloud.idle(); });
    useEncryptionStore.getState().lockVault();
    await act(async () => { expect(await result.current.removeLabel('l1')).toBe(true); });
    expect(result.current.labels).toEqual([{ id: 'l2', name: 'Эпсилон', color: C1 }]);
  });

  const OTHER = 'user_lb1_other';
  async function switchedAway(before: (r: { current: ReturnType<typeof useProfileLabels> }) => Promise<void>) {
    await seed(['Альфа']);
    cloud.put(OTHER, { uid: OTHER, labels: [{ id: 'o1', name: 'Чужая', color: C1 }] });
    const h = renderHook(({ uid }: { uid: string }) => useProfileLabels(uid), { initialProps: { uid: UID } });
    await waitFor(() => expect(shown(h.result)).toEqual(['Альфа']));
    await before(h.result);
    h.rerender({ uid: OTHER });
    expect(shown(h.result)).not.toContain('Альфа'); // список прежней учётки снят сразу
    await waitFor(() => expect(shown(h.result)).toEqual(['Чужая']));
    return h.result;
  }

  it('N-5: сменилась учётка — список прежней не показывается, её поздний ответ чтения не принимается', async () => {
    let late!: () => void;
    const result = await switchedAway(async () => {
      await act(async () => { useEncryptionStore.getState().lockVault(); });
      late = cloud.hold('read');
      const reads = cloud.calls.read;
      await act(async () => { useEncryptionStore.getState().setKey(key); });
      await waitFor(() => expect(cloud.calls.read).toBe(reads + 1)); // чтение прежней учётки в пути
    });
    await act(async () => { late(); await cloud.idle(); });
    expect(shown(result)).toEqual(['Чужая']);
  });

  it('N-5: правка завершилась после смены учётки — итог верный, на экран другой учётки ничего не пишется', async () => {
    let land!: () => void;
    let p!: Promise<boolean>;
    const result = await switchedAway(async r => {
      land = cloud.hold('write');
      await act(async () => { p = r.current.addLabel({ name: 'Бета', color: C1 }); await Promise.resolve(); });
      await waitFor(() => expect(cloud.calls.write).toBe(1));
    });
    await act(async () => { land(); expect(await p).toBe(true); await cloud.idle(); });
    expect(shown(result)).toEqual(['Чужая']);
    expect(await cloudNames()).toEqual(['Альфа', 'Бета']);
  });

  it('перечитывание после наложения правок не удалось — запись в журнале', async () => {
    await seed(['Альфа']);
    const { result } = await mountLoaded(1);
    const ack = cloud.hold('ack');
    let early!: Promise<boolean>;
    await act(async () => { early = result.current.addLabel({ name: 'Бета', color: C1 }); await Promise.resolve(); });
    await waitFor(() => expect(cloud.labels(UID).length).toBe(2));
    await act(async () => { expect(await result.current.addLabel({ name: 'Гамма', color: C1 })).toBe(true); });
    cloud.failNext('read', new Error('network'));
    await act(async () => { ack(); expect(await early).toBe(true); await cloud.idle(); });
    expect(vi.mocked(reportError).mock.calls.some(c => (c[1] as { action?: string })?.action === 'profileLabels/fetchProfile_overlap')).toBe(true);
  });
});
