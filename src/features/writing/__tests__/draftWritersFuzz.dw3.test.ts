/**
 * DW-3 (пакет DW, 31.10): один харнесс на все пути записи черновика.
 *
 * Гоняет настоящие хуки и сервисы: `useBaseWritingSession` +
 * `useSessionPersistence` + `useDraftAutosave` + `useDraftCore` +
 * `WritingDraftService` + `draftPersistence` + `sessionActions` для аккаунта,
 * `useGuestWritingSession` + `useDraftManager` + `GuestDraftService` для гостя,
 * `migrateDocuments` при входе из гостя, `reloadForAccountChange` при смене
 * аккаунта. Мокнут только края: облако с управляемой задержкой и отказом,
 * очередь синка, шифрование, режим вёрстки, журнал ошибок. Хранилища —
 * настоящие (`fake-indexeddb`, `localStorage`, `sessionStorage`).
 *
 * Последовательности случайны и воспроизводимы по сидy (mulberry32 — своя
 * функция, как в `dialogueMerge.s36.test.ts`, без новой зависимости). На
 * каждом наблюдении (перезагрузка вкладки, новая вкладка, вход из гостя)
 * проверяются инварианты I1–I5 из DW-2. Нарушение — не правка прода, а
 * находка: сид, шаги и адреса хранилищ идут в отчёт.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUser } from '../../../core/auth/types';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../core/storage/localDb';
import { LocalStorageService } from '../../../core/services/LocalStorageService';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { resetSession } from '../store/storeActions';
import { cleanupDraftsAfterSave } from '../utils/sessionActions';
import { applySessionEnd, resolve } from '../services/draftWriter';
import { useBaseWritingSession } from '../hooks/useBaseWritingSession';
import { useSessionPersistence } from '../hooks/useSessionPersistence';
import { useGuestWritingSession } from '../hooks/useGuestWritingSession';
import { useWpm } from '../hooks/useWpm';
import { migrateDocuments } from '../../auth/services/migrateDocuments';
import { reloadForAccountChange, _resetAccountReloadForTesting, isAccountReloadPending } from '../../../core/auth/accountReload';

type Row = Record<string, unknown>;

const env = vi.hoisted(() => ({
  cloud: new Map<string, Row>(),
  /** Задержка ответа облака, виртуальные мс. */
  latency: 0,
  /** `throw` — отказ; `drop` — дошло, но ответ потерян (строка лежит, метки нет). */
  outcome: 'ok' as 'ok' | 'throw' | 'drop',
  syncOn: true,
  profileLoaded: true,
  layout: 'mobile' as 'mobile' | 'desktop',
  errors: [] as Array<{ action: string; message: string }>,
  cloudSaves: 0,
  cloudDeletes: 0,
}));

/**
 * Часы виртуальные (`setTimeout`/`setInterval`/`Date`/rAF), но `setImmediate`
 * остаётся настоящим: им работает fake-indexeddb. Иначе любая запись в базу
 * встанет — транзакция IDB завершается вне виртуального времени, а `await`
 * внутри операции не даст драйверу крутить часы.
 *
 * Поэтому каждая блокирующая операция идёт через `settle()`: пока она не
 * завершилась, виртуальный час двигается мелкими шагами. Порядок переплетений
 * при этом остаётся под контролем: «облако ещё в пути, а отсрочка уже
 * сработала» — это просто `latency` больше шага отсрочки.
 */
const STEP_MS = 25;

async function settle<T>(p: Promise<T>, capMs = 200_000): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  let failed = false;
  void p.then(
    (v) => { done = true; value = v; },
    (e) => { done = true; failed = true; error = e; },
  );
  let spent = 0;
  while (!done && spent < capMs) {
    await act(async () => { await vi.advanceTimersByTimeAsync(STEP_MS); });
    spent += STEP_MS;
  }
  if (!done) throw new Error(`DW3: операция не завершилась за ${capMs} виртуальных мс`);
  if (failed) throw error;
  return value as T;
}

vi.mock('../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => env.syncOn }));
vi.mock('../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => env.profileLoaded,
}));
vi.mock('../../../core/services/SyncService', () => ({
  SyncService: { syncOne: async () => 'dw-cloud-doc', addToQueue: async () => undefined },
}));
vi.mock('../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: env.layout }) }));
vi.mock('../../../shared/errors/reportError', () => ({
  reportError: (err: unknown, ctx?: { action?: string }) => {
    env.errors.push({ action: String(ctx?.action ?? ''), message: String(err instanceof Error ? err.message : err) });
  },
}));
vi.mock('../../../core/data', () => ({
  DataProvider: {
    getDraft: async (uid: string) => {
      const row = env.cloud.get(uid);
      return row ? (JSON.parse(JSON.stringify(row)) as Row) : null;
    },
    saveDraft: async (uid: string, data: Row) => {
      env.cloudSaves++;
      if (env.outcome === 'drop') {
        env.cloud.set(uid, { ...data, userId: uid, updatedAt: Date.now() });
        await new Promise(r => setTimeout(r, Math.max(env.latency, 40_000)));
        return Date.now();
      }
      await new Promise(r => setTimeout(r, env.latency));
      if (env.outcome === 'throw') throw new Error('DW3 cloud save refused');
      env.cloud.set(uid, { ...data, userId: uid, updatedAt: Date.now() });
      return Date.now();
    },
    updateDraft: async (uid: string, data: Row) => {
      await new Promise(r => setTimeout(r, env.latency));
      if (env.outcome === 'throw') throw new Error('DW3 cloud update refused');
      env.cloud.set(uid, { ...data, userId: uid, updatedAt: Date.now() });
    },
    deleteDraft: async (uid: string) => {
      env.cloudDeletes++;
      if (env.outcome === 'drop') {
        env.cloud.delete(uid);
        await new Promise(r => setTimeout(r, Math.max(env.latency, 40_000)));
        return;
      }
      await new Promise(r => setTimeout(r, env.latency));
      if (env.outcome === 'throw') throw new Error('DW3 cloud delete refused');
      env.cloud.delete(uid);
    },
  },
}));

/* ------------------------------------------------------------------ мир */

interface StoreSnapshot {
  idb: string | null;
  legacy: string | null;
  cloud: string | null;
  guestIdb: string | null;
  guestLs: string | null;
}

interface Violation {
  inv: 'I1' | 'I2' | 'I3' | 'I4' | 'I5';
  seed: number;
  step: number;
  op: string;
  detail: string;
}

const shake = (n: number) => `s${n}`;
const trim = (s: string | null): string => (s === null ? '∅' : s.length > 24 ? `${s.slice(0, 24)}…` : s);

/** Две строки длиной 24 знака различимы не всегда — показываем место расхождения. */
function diff(want: string, got: string): string {
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i++;
  return `разница с ${i}: ждали «${want.slice(i, i + 24)}» (длина ${want.length}), получили «${got.slice(i, i + 24)}» (длина ${got.length})`;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Тот же стек, что собирает экран письма для вошедшего. */
function useAccountSession(props: { user: AppUser | null }) {
  const base = useBaseWritingSession();
  const content = useContentStore(s => s.content);
  const wordCount = useContentStore(s => s.wordCount);
  const seconds = useTimerStore(s => s.seconds);
  const { wpm } = useWpm();
  const persistence = useSessionPersistence(
    props.user,
    null,
    {
      title: base.title,
      content,
      pinnedThoughts: base.pinnedThoughts,
      tags: base.tags,
      sessionType: base.sessionType,
      activeSessionId: base.activeSessionId,
      initialDuration: base.initialDuration,
      initialWordCount: base.initialWordCount,
      sessionStartTime: base.sessionStartTime,
    },
    {
      seconds,
      wpm,
      wordCount,
      status: base.status,
      timeGoalReached: base.timeGoalReached,
      wordGoalReached: base.wordGoalReached,
    },
    {
      setContent: base.setContent,
      setTitle: base.setTitle,
      setPinnedThoughts: base.setPinnedThoughts,
      setActiveSessionId: base.setActiveSessionId,
      setHasDraft: () => undefined,
      setDraftInEditor: () => undefined,
      resetAndClear: base.resetAndClear,
      resetSession: base.resetSession,
      setStatus: base.setStatus,
      setInitialWordCount: base.setInitialWordCount,
      setInitialDuration: base.setInitialDuration,
    },
  );
  return { base, persistence };
}

interface Mark { owner: string; text: string; at: number }

/**
 * Счётчики за весь файл (не сбрасываются между тестами): чем харнесс был, а не
 * только чем он «не покраснел». Храповик в конце файла не даёт харнессу
 * позеленеть вакуумно — если писатели перестанут вызываться, он краснеет.
 */
const tally = { observations: 0, recoveredNonEmpty: 0, sawIdbRow: 0, sawLegacy: 0, sawGuest: 0, crossed: 0 };

function observeTally(before: StoreSnapshot, recovered: string | null): void {
  tally.observations++;
  if (recovered) tally.recoveredNonEmpty++;
  if (before.idb) tally.sawIdbRow++;
  if (before.legacy) tally.sawLegacy++;
  if (before.guestIdb || before.guestLs) tally.sawGuest++;
}

class World {
  readonly seed: number;
  readonly uidA: string;
  readonly uidB: string;
  guestUid: string;
  owner: string;
  isGuest = false;
  step = 0;
  log: string[] = [];
  violations: Violation[] = [];
  /** Локальный набор проиграл облачной копии другого прибора (правило спора). */
  crossed: Array<{ seed: number; step: number; op: string; lost: string; won: string }> = [];
  /** Каждое состояние редактора: кому принадлежало и на каком шаге. */
  typed: Mark[] = [];
  saves: Mark[] = [];
  deletes: Mark[] = [];
  /** Кому какой гостевой текст разрешено унаследовать (I4). */
  linked = new Map<string, string>();
  /** 4.3.2: слово → uid набравшего. Слова уникальны (метка шага+номер). */
  wordOwner = new Map<string, string>();
  private view: RenderHookResult<ReturnType<typeof useAccountSession>, { user: AppUser | null }> | null = null;
  private guestView: RenderHookResult<ReturnType<typeof useGuestWritingSession>, undefined> | null = null;
  /**
   * Объект пользователя ОДИН на uid. В приложении его держит контекст авторизации,
   * и эффект размонтирования в `useDraftAutosave` живёт стабильно; новый объект
   * на каждый рендер заставил бы этот эффект перерегистрироваться каждую
   * перерисовку — и подъём поколения случался бы не по делу.
   */
  private users = new Map<string, AppUser>();

  constructor(seed: number) {
    this.seed = seed;
    this.uidA = `u-a-${seed}`;
    this.uidB = `u-b-${seed}`;
    this.guestUid = `guest_dw${seed}`;
    this.owner = this.uidA;
  }

  private record(op: string): void {
    this.log.push(`${this.step}:${op}`);
    this.step++;
  }

  get text(): string {
    return useContentStore.getState().content;
  }

  user(): AppUser | null {
    if (this.isGuest) return null;
    let u = this.users.get(this.owner);
    if (!u) {
      u = { uid: this.owner } as AppUser;
      this.users.set(this.owner, u);
    }
    return u;
  }

  /** Двигает виртуальные часы; экран письма за это время перерисовывается. */
  async tick(ms: number): Promise<void> {
    await this.drain(ms);
    this.rerender();
  }

  /** Только часы: так доходят отсроченные записи, не перерисовывая экран. */
  async drain(ms: number): Promise<void> {
    let left = ms;
    while (left > 0) {
      await act(async () => { await vi.advanceTimersByTimeAsync(STEP_MS); });
      left -= STEP_MS;
    }
  }

  /**
   * Долгий набор: 30–45 с, чтобы пересечь порог страховочных интервалов
   * (`useDraftAutosave.ts:258` у аккаунта, `useDraftManager.ts:94` у гостя).
   * Шаг крупнее (500 мс) — при 25 мс такой проход стоил бы минуту прогона, а
   * точность здесь нужна только «пересечь 30 с».
   */
  async longTick(ms: number): Promise<void> {
    let left = ms;
    while (left > 0) {
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      left -= 500;
    }
    this.rerender();
    this.record(`долго ${Math.round(ms / 1000)} с`);
  }

  private rerender(): void {
    if (this.view) this.view.rerender({ user: this.user() });
  }

  async openAccount(uid: string): Promise<void> {
    this.owner = uid;
    this.isGuest = false;
    this.view = renderHook(p => useAccountSession(p), { initialProps: { user: this.user() } });
    this.record('open');
    await this.tick(10);
  }

  async openGuest(): Promise<void> {
    localStorage.setItem('jw_guest_id', this.guestUid);
    this.owner = this.guestUid;
    this.isGuest = true;
    this.guestView = renderHook(() => useGuestWritingSession());
    this.record('open-guest');
    await this.tick(10);
  }

  unmount(): void {
    this.view?.unmount();
    this.view = null;
    this.guestView?.unmount();
    this.guestView = null;
  }

  /** Смена аккаунта по-настоящему: `reloadForAccountChange` и чистая вкладка. */
  async switchByReload(uid: string): Promise<void> {
    await settle(reloadForAccountChange());
    // `isAccountReloadPending()` — и уход со страницы по своим правилам
    // пропускает запись: флешер выше уже отдал текст владельцу.
    await this.leaveTab(false);
    this.record(`switch-reload→${uid.slice(0, 5)}`);
    await this.openAccount(uid);
  }

  /** Набор: n слов настоящим `setContent` стора текста. */
  async type(words: number): Promise<void> {
    const add: string[] = [];
    for (let i = 0; i < words; i++) add.push(`${shake(this.step)}w${i}`);
    const next = `${this.text ? `${this.text} ` : ''}${add.join(' ')}`;
    useContentStore.getState().setContent(next);
    for (const word of add) this.wordOwner.set(word, this.owner);
    await this.tick(20);
    this.typed.push({ owner: this.owner, text: this.text, at: this.step });
    this.record(`type+${words}`);
  }

  /**
   * Сохранение заметки — тот же порядок, что `handleSave`.
   *
   * `holdWindowMs` задаёт окно DY10-10: облачный хвост (`deleteDraftCloud` и
   * `syncOne`) ещё не доделан, `resetSession()` ещё не было, а часы уже идут —
   * отсроченная запись и перерисовка попадают внутрь окна. Без этого шага
   * сохранение было бы атомарным, и дыра в окне не проверялась бы.
   */
  async saveNote(holdWindowMs = 0, duringWindow?: () => Promise<void>): Promise<void> {
    const content = this.text;
    const uid = this.owner;
    if (!content.trim()) { this.record('save(пусто)'); return; }
    useContentStore.getState().recalcStats();
    const { localId } = await settle(LocalStorageService.saveNew(uid, {
      title: useContentStore.getState().title,
      content,
      wordCount: useContentStore.getState().wordCount,
      duration: 10,
      wpm: 10,
      tags: [],
      sessionStartedAt: new Date(Date.now()),
    }));
    useSessionMetaStore.getState().setSavedDocumentId(localId);
    if (holdWindowMs > 0) {
      const inFlight = cleanupDraftsAfterSave(uid, this.isGuest, localId);
      await this.tick(holdWindowMs);
      if (duringWindow) await duringWindow();
      await settle(inFlight);
    } else {
      await settle(cleanupDraftsAfterSave(uid, this.isGuest, localId));
    }
    this.saves.push({ owner: uid, text: content, at: this.step });
    // Гостевое сохранение чистит черновик того же прибора — это и закрытка, и
    // удаление: надгробия у гостя нет, проверять I5 для него нечем.
    if (this.isGuest) this.deletes.push({ owner: uid, text: content, at: this.step });
    this.record(holdWindowMs > 0 ? `save(окно ${holdWindowMs})` : 'save');
    resetSession();
    this.rerender();
    await this.tick(20);
  }

  /** Офлайн-финиш: сохранение без облачного хвоста. */
  async saveNoteOffline(): Promise<void> {
    const prev = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    await this.saveNote();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => prev });
  }

  async background(): Promise<void> {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    spy.mockRestore();
    await settle(Promise.resolve());
    this.record('background');
  }

  async pageHide(): Promise<void> {
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    this.record('pagehide');
  }

  /** «Отменить» / «Сбросить» — настоящий `handleCancel` активного стека. */
  async discard(): Promise<void> {
    const text = this.text;
    const uid = this.owner;
    const fn = this.isGuest ? this.guestView?.result.current.handleCancel : this.view?.result.current.persistence.handleCancel;
    if (!fn) {
      this.record('discard(нет стека)');
      throw new Error(`DW3: нет активного стека для «отмены» — шаг ${this.step}, isGuest=${this.isGuest}`);
    }
    await settle(fn());
    this.deletes.push({ owner: uid, text, at: this.step });
    this.rerender();
    this.record('discard');
    await this.tick(20);
  }

  /**
   * Уход со страницы так, как его делает браузер: `pagehide`, снятие экрана,
   * место недосланным записям, и только потом новая страница.
   *
   * N1-4 `staleUnmount`: вкладка умерла сразу после `pagehide` — снимок в
   * localStorage остался, а строка IndexedDB не дописана. В браузере запись W5
   * делает размонтирование React, которого при смерти вкладки не бывает. Здесь
   * размонтирование неизбежно (иначе эффект повиснет), поэтому оно глушится
   * поднятым ДО него поколением — тот же страж DY10-10, что запрещает
   * опоздавшей записи тереть свежее, — и следом возвращается снимок, который
   * `persistDraft` (`draftPersistence.ts:80-82`) стирает на своих условиях.
   * Состояние получается ровно то, которого харнесс раньше не касался: копия в
   * localStorage НОВЕЕ строки базы.
   *
   * Шаг отказывается моделировать смерть вкладки, пока в модуле висит flag
   * «перезагрузка из-за смены аккаунта» (`isAccountReloadPending`, вето
   * `useDraftCore.ts:215`): `switchByReload` выставляет его и по замыслу держит
   * (комментарий там же), а настоящей перезагрузки страницы в харнессе нет, поэтому
   * на следующих шагах запись при закрытии законно не происходит и сравнивать
   * выбор копий не с чем. В этом случае шаг деградирует до обычного `reload`.
   */
  private async leaveTab(freshTab: boolean, staleUnmount = false): Promise<void> {
    const wantStale = staleUnmount && !this.isGuest && !isAccountReloadPending();
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    let unloadSnapshot: string | null = null;
    if (wantStale) {
      // Писатель вправе пропустить запись при закрытии (сейф, устаревшее
      // поколение, уходящий аккаунт). Тогда состояния «копия новее строки базы»
      // в этом шаге просто нет, и шаг деградирует до обычного `reload`, а не
      // изобретает запись за приложение.
      const raw = localStorage.getItem(STORAGE_KEYS.DRAFT(this.owner));
      const snap = await settle(this.snapshot(this.owner));
      if (raw !== null && snap.legacy !== null && snap.legacy !== snap.idb) unloadSnapshot = raw;
    }
    // Шаг 5: смерть вкладки — это конец сессии письма, а не закрытый черновик.
    if (unloadSnapshot !== null) applySessionEnd(this.owner);
    this.unmount();
    await this.drain(1_000);
    if (unloadSnapshot !== null) {
      // `persistDraft` (`draftPersistence.ts:80-82`) снял ключ, хотя записи в
      // базу не было — в мёртвой вкладке этого вызова не произошло бы.
      localStorage.setItem(STORAGE_KEYS.DRAFT(this.owner), unloadSnapshot);
    }
    if (freshTab) sessionStorage.clear();
    resetSession();
  }

  /** Что человек увидит, вернувшись к редактору. */
  private async observe(op: string, freshTab: boolean, staleUnmount = false): Promise<string | null> {
    const uid = this.owner;
    const isGuest = this.isGuest;
    const before = await settle(this.snapshot(uid));
    await this.leaveTab(freshTab, staleUnmount);
    this.record(op + (freshTab ? '(новая вкладка)' : ''));
    const step = this.step - 1;

    let recovered: string | null = null;
    if (isGuest) {
      const draft = await settle(resolve(this.guestUid, { guest: true }));
      recovered = draft?.content ?? null;
    } else {
      const draft = await settle(resolve(uid));
      recovered = draft?.content ?? null;
    }
    if (!isGuest) await this.openAccount(uid);
    else await this.openGuest();
    // Новая страница должна успеть подтянуть черновик в редактор: 300 мс
    // заведомо меньше отсрочки (500/1000 мс), поэтому владелец текста ещё не
    // проставлен — наблюдение ловит то же состояние, что и свежая страница в
    // браузере.
    await this.drain(300);

    observeTally(before, recovered);
    const beforeCount = this.violations.length;
    this.checkObservation({ step, op, uid, recovered, before, isGuest });
    if (this.violations.length > beforeCount) {
      // После наблюдения: какой именно адрес держит то, что увидел человек.
      const after = await settle(this.snapshot(uid));
      for (const v of this.violations.slice(beforeCount)) v.detail += `; после: ${this.fmt(after)}`;
    }
    return recovered;
  }

  async reload(freshTab = false): Promise<string | null> {
    return this.observe('reload', freshTab);
  }

  /**
   * N1-4: перезагрузка после закрытия вкладки, где запись в базу НЕ доделалась:
   * снимок в localStorage новее строки IndexedDB. Именно это состояние прежний
   * выбор `localDraft || legacyDraft` терял.
   */
  async reloadStale(): Promise<string | null> {
    return this.observe('reload(не дописано)', false, true);
  }

  /** Черновик, который видит человек: любой из адресов аккаунта. */
  async draftTextFor(uid: string): Promise<string | null> {
    const s = await settle(this.snapshot(uid));
    return s.idb ?? s.legacy ?? s.cloud ?? null;
  }

  async snapshot(uid: string): Promise<StoreSnapshot> {
    const idb = await this.readIdb(uid, uid);
    const guestIdb = await this.readIdb(undefined, 'guest_draft');
    const legacyRaw = localStorage.getItem(STORAGE_KEYS.DRAFT(uid));
    const guestRaw = localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT);
    const cloudRow = env.cloud.get(uid);
    return {
      idb: idb?.content ?? null,
      legacy: legacyRaw ? (JSON.parse(legacyRaw) as { content?: string }).content ?? null : null,
      cloud: cloudRow ? String(cloudRow.content ?? '') || null : null,
      guestIdb: guestIdb?.content ?? null,
      guestLs: guestRaw ? (JSON.parse(guestRaw) as { content?: string }).content ?? null : null,
    };
  }

  private async readIdb(uid: string | undefined, key: string): Promise<LocalDraft | undefined> {
    const db = await getLocalDb(uid);
    if (!db.objectStoreNames.contains('drafts')) return undefined;
    return await db.get('drafts', key);
  }

  /**
   * Ожидание по I1/I2/I5: «закрытка» черновика — это сохранение заметки или
   * удаление. Набранным и не закрытым считается последний текст владельца, у
   * которого `at` позже последней закрытки этого же владельца.
   */
  private expectFor(uid: string): Mark | null {
    const lastType = [...this.typed].reverse().find(t => t.owner === uid);
    if (!lastType) return null;
    const closed = Math.max(-1, ...[...this.saves, ...this.deletes].filter(s => s.owner === uid).map(s => s.at));
    return lastType.at > closed ? lastType : null;
  }

  private checkObservation(o: { step: number; op: string; uid: string; recovered: string | null; before: StoreSnapshot; isGuest: boolean }): void {
    const seen = o.recovered ?? '';
    const expected = this.expectFor(o.uid);
    const owners = new Set(this.typed.filter(t => t.text === seen).map(t => t.owner));
    const fromOtherDevice = [...owners].some(x => x.endsWith('@B'));
    if (expected && seen !== expected.text) {
      if (fromOtherDevice) {
        // Спор копий: своё, не закрытое заметкой, проиграло облачной строке
        // другого прибора. Это не падение харнесса, а задокументированное
        // правило `decideDraftCopy` — считаем отдельно.
        this.crossed.push({ seed: this.seed, step: o.step, op: o.op, lost: expected.text, won: seen });
        tally.crossed++;
      } else {
        this.fail('I1', o.step, o.op, `${diff(expected.text, seen)}; до перезагрузки: ${this.fmt(o.before)}`);
      }
    }
    if (!expected) {
      // Пустой редактор — не «удалённый» и не «сохранённый» текст: пустоту
      // восстановить нельзя, и проверка на ней была бы зелёной вакуумно.
      const saved = [...this.saves].reverse().find(s => s.owner === o.uid && s.text.trim() !== '');
      if (saved && seen === saved.text) {
        this.fail('I2', o.step, o.op, `сохранённый заметкой текст вернулся черновиком: «${trim(seen)}»; ${this.fmt(o.before)}`);
      }
      const del = [...this.deletes].reverse().find(d => d.owner === o.uid && d.text.trim() !== '');
      if (del && seen === del.text) {
        this.fail('I5', o.step, o.op, `удалённый черновик восстановился: «${trim(seen)}»`);
      }
    }
    for (const own of owners) {
      if (own !== o.uid && this.linked.get(own) !== o.uid && !own.endsWith('@B')) {
        this.fail('I3', o.step, o.op, `текст, набранный «${own}», восстановился у «${o.uid}»; ${this.fmt(o.before)}`);
      }
    }
    // 4.3.2 (DW4-4): пословная проверка I3 — в адресе B не должно быть НИ
    // ОДНОГО слова, набранного другим аккаунтом. Проверка по цельному тексту
    // ловит только точные совпадения; смешанный буфер («половина A + половина
    // B») целиком ни с чем не совпадёт и ускользал бы. Слова помечены шагом
    // набора, поэтому виновник находится точно.
    for (const word of seen.split(/\s+/).filter(Boolean)) {
      const by = this.wordOwner.get(word);
      if (!by || by === o.uid || this.linked.get(by) === o.uid) continue;
      this.fail('I3', o.step, o.op, `слово «${word}» набрано «${by}», а лежит в адресе «${o.uid}»; ${this.fmt(o.before)}`);
    }
  }

  private fmt(s: StoreSnapshot): string {
    return `idb=${trim(s.idb)} legacy=${trim(s.legacy)} cloud=${trim(s.cloud)} guestIdb=${trim(s.guestIdb)} guestLs=${trim(s.guestLs)}`;
  }

  private fail(inv: Violation['inv'], step: number, op: string, detail: string): void {
    this.violations.push({ inv, seed: this.seed, step, op, detail });
  }

  /* -------------------------------------------------- соседнее устройство */

  /**
   * Второе устройство: его след на единственном общем для двух приборов
   * хранилище — облачная строка. Локальная половина прибора B на прибор A
   * повлиять не может по построению, поэтому здесь она не моделируется.
   */
  async deviceBWrite(uid: string, words: number): Promise<void> {
    const add: string[] = [];
    for (let i = 0; i < words; i++) add.push(`${shake(this.step)}b${i}`);
    const text = add.join(' ');
    env.cloud.set(uid, { userId: uid, content: text, title: '', wordCount: words, updatedAt: Date.now() });
    for (const word of add) this.wordOwner.set(word, uid);
    this.typed.push({ owner: `${uid.slice(0, 5)}@B`, text, at: this.step });
    this.record(`B-пишет(${uid.slice(0, 5)})`);
  }

  async deviceBDelete(uid: string): Promise<void> {
    env.cloud.delete(uid);
    this.record(`B-удаляет(${uid.slice(0, 5)})`);
  }

  /** Вход из гостя: `pagehide` гостя, перенос `migrateDocuments`, чистая вкладка. */
  async signIn(accountUid: string): Promise<void> {
    const guestText = this.text;
    const guest = this.guestUid;
    if (guestText.trim()) this.linked.set(guest, accountUid);
    await this.leaveTab(false);
    const res = await settle(migrateDocuments(accountUid));
    this.owner = accountUid;
    this.isGuest = false;
    this.record(`вход-из-гостя(moved=${res.moved})`);
    await this.openAccount(accountUid);
    if (guestText.trim()) {
      const inDraft = await this.draftTextFor(accountUid);
      const inNotes = await this.noteHasText(accountUid, guestText);
      if (inDraft !== guestText && !inNotes) {
        this.fail('I4', this.step - 1, 'вход-из-гостя', `гостевой текст «${trim(guestText)}» не найден ни в черновике, ни в заметках аккаунта`);
      }
    }
  }

  private async noteHasText(uid: string, text: string): Promise<boolean> {
    const db = await getLocalDb(uid);
    const versions = await db.getAll('versions');
    return versions.some(v => v.content === text);
  }
}

/* ------------------------------------------------------------------ окружение */

beforeEach(() => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  // Своя IndexedDB на тест: гостевой черновик лежит под литеральным ключом
  // `guest_draft` в общей базе, и строка прошлого теста сделала бы следующий
  // сид зелёным или красным не по своей причине.
  localStorage.clear();
  sessionStorage.clear();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetDbInstance();
  env.cloud.clear();
  env.latency = 0;
  env.outcome = 'ok';
  env.syncOn = true;
  env.profileLoaded = true;
  env.layout = 'mobile';
  env.errors.length = 0;
  resetSession();
  // DW4-4: снимок спасения — уровня вкладки, как зеркало владельца; тесту он
  // должен доставаться пустым.
  useTimerStore.setState({ status: 'idle' });
  _resetAccountReloadForTesting();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { reload: vi.fn(), assign: vi.fn(), replace: vi.fn(), href: 'http://localhost/' },
  });
});

afterEach(() => {
  delete (navigator as { onLine?: unknown }).onLine;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ прогоны */

/**
 * Операции случайной последовательности. Повтор в списке = вес. Собраны так,
 * чтобы окно «сохранение заметки ещё не закрылось, а отсрочка уже сработала»
 * (DY10-10) встречалось часто: без этого харнесс не был бы красным на коде до
 * правки.
 */
const ACCOUNT_OPS = [
  'type', 'type', 'type', 'tick', 'tick', 'tick', 'long-tick', 'save', 'save', 'save-offline',
  'background', 'pagehide', 'reload', 'reload', 'unload-stale', 'new-tab', 'switch', 'discard',
  'device-b', 'device-b-delete', 'slow-net', 'slow-net', 'fast-net',
  'cloud-throw', 'cloud-drop', 'cloud-ok', 'sync-off', 'no-profile',
] as const;

/** Гость: своих писателей два (отсрочка + 30 с) и свои страховки — без поколения. */
const GUEST_OPS = [
  'type', 'type', 'type', 'tick', 'tick', 'tick', 'long-tick', 'save', 'background', 'pagehide',
  'reload', 'reload', 'new-tab', 'discard', 'slow-net', 'fast-net',
] as const;

async function runAccountSeed(seed: number, steps: number): Promise<World> {
  resetSession();
  const rnd = mulberry32(seed);
  const w = new World(seed);
  await w.openAccount(w.uidA);
  for (let i = 0; i < steps; i++) {
    const op = ACCOUNT_OPS[Math.floor(rnd() * ACCOUNT_OPS.length)];
    const roll = rnd();
    switch (op) {
      case 'type': await w.type(1 + Math.floor(roll * 3)); break;
      case 'tick': await w.tick(200 + Math.floor(roll * 3_000)); break;
      case 'long-tick': await w.longTick(30_000 + Math.floor(roll * 15_000)); break;
      case 'save': await w.saveNote(roll < 0.45 ? 0 : 400 + Math.floor(roll * 1_200)); break;
      case 'save-offline': await w.saveNoteOffline(); break;
      case 'background': await w.background(); break;
      case 'pagehide': await w.pageHide(); break;
      case 'reload': await w.reload(); break;
      case 'unload-stale': await w.reloadStale(); break;
      case 'new-tab': await w.reload(true); break;
      case 'switch': await w.switchByReload(w.uidB); break;
      case 'discard': await w.discard(); break;
      case 'device-b': await w.deviceBWrite(roll < 0.5 ? w.uidA : w.uidB, 1 + Math.floor(roll * 4)); break;
      case 'device-b-delete': await w.deviceBDelete(roll < 0.5 ? w.uidA : w.uidB); break;
      case 'slow-net': env.latency = 400 + Math.floor(roll * 3_000); break;
      case 'fast-net': env.latency = 0; break;
      case 'cloud-throw': env.outcome = 'throw'; break;
      case 'cloud-drop': env.outcome = 'drop'; break;
      case 'cloud-ok': env.outcome = 'ok'; break;
      case 'sync-off': env.syncOn = roll < 0.5; break;
      case 'no-profile': env.profileLoaded = roll < 0.5; break;
    }
  }
  await w.reload();
  return w;
}

async function runGuestSeed(seed: number, steps: number): Promise<World> {
  resetSession();
  const rnd = mulberry32(seed);
  const w = new World(seed);
  await w.openGuest();
  for (let i = 0; i < steps; i++) {
    const op = GUEST_OPS[Math.floor(rnd() * GUEST_OPS.length)];
    const roll = rnd();
    switch (op) {
      case 'type': await w.type(1 + Math.floor(roll * 3)); break;
      case 'tick': await w.tick(200 + Math.floor(roll * 3_000)); break;
      case 'long-tick': await w.longTick(30_000 + Math.floor(roll * 15_000)); break;
      case 'save': await w.saveNote(); break;
      case 'background': await w.background(); break;
      case 'pagehide': await w.pageHide(); break;
      case 'reload': await w.reload(); break;
      case 'new-tab': await w.reload(true); break;
      case 'discard': await w.discard(); break;
      case 'slow-net': env.latency = 400 + Math.floor(roll * 3_000); break;
      case 'fast-net': env.latency = 0; break;
    }
  }
  // Финал гостевого пути всегда вход: I4 проверяется на настоящем переносе.
  await w.signIn(w.uidA);
  return w;
}

function report(w: World): string {
  return [
    `seed=${w.seed}`,
    `споры копий: ${w.crossed.length}`,
    `шаги: ${w.log.join(' | ')}`,
    ...w.violations.map(v => `${v.inv}@${v.step} ${v.op}: ${v.detail}`),
  ].join('\n');
}

const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 222, 333, 444, 555, 666, 777,
  121, 232, 343, 454, 676, 787, 898, 183, 565, 81, 191, 266];
// 565 (текст прежнего владельца штамповался новому аккаунту) и 183 (набор после
// смены аккаунта в приложении не ложился ни в один адрес) — сиды находки DW-F-3.
// После DW-7 (владелец ставится в момент подстановки черновика, ответ загрузки
// прежнего аккаунта не подставляется) оба зелены и держатся как стражи.
// 191 — DW-9: набор под A, смена аккаунта в этой же вкладке на B, закрытие
// вкладки. Без сверки владельца запись при закрытии клала текст A в ключ B.
// 266 — DW-9: набранное под B числилось текстом A (владелец проставлялся только
// записью, а отсроченная запись прежнего аккаунта успевала объявить его своим
// раньше), и сверка при закрытии вкладки не писала его никуда — потеря.
// Правка «кто печатает, тот и владелец» закрывает окно.
// 103 — заметка ревьюера 03.11 13:55: поздняя гостевая отсрочка в окне
// сохранения (класс DY10-10). Закрыт на dw4-2 именованной эпохой отсрочки
// (GuestDraftService → applyWrite); держится как страж.
const GUEST_SEEDS = [12, 23, 34, 45, 56, 67, 78, 89, 103, 131, 242, 353, 464];

describe('DW-3: харнесс путей записи черновика', () => {
  it('управление харнесса: отсрочка действительно пишет, а проверка не пуста', async () => {
    const w = new World(9_000);
    await w.openAccount(w.uidA);
    expect(await w.draftTextFor(w.uidA), 'до набора черновика быть не должно').toBeNull();
    await w.type(2);
    expect(await w.draftTextFor(w.uidA), 'записи до истечения отсрочки и быть не должно — часы стоят').toBeNull();
    await w.drain(1_200);
    expect(await w.draftTextFor(w.uidA), 'после отсрочки строка обязана появиться').toBe(w.text);
    w.unmount();
  });

  it('окно DY10-10: отсрочка и перерисовка внутри незакрытого сохранения не возвращают сохранённое', async () => {
    env.latency = 3_000;
    const w = new World(9_001);
    await w.openAccount(w.uidA);
    await w.type(3);
    const saved = w.text;
    await w.saveNote(1_500);
    await w.reload();
    const seen = await w.draftTextFor(w.uidA);
    expect(seen, `сохранённый текст вернулся черновиком: ${JSON.stringify({ saved, seen })}`).not.toBe(saved);
    expect(w.violations, report(w)).toEqual([]);
    w.unmount();
  });

  /**
   * N1-4: раньше харнесс не моделировал состояние «снимок в localStorage новее
   * строки IndexedDB» — `leaveTab` всегда размонтировал стек, а размонтирование
   * само дописывает базу (W5). Теперь есть шаг `reload(не дописано)`.
   */
  it('N1-4: вкладка умерла до записи в базу — возвращаются последние слова, а не старая строка', async () => {
    const w = new World(9_004);
    await w.openAccount(w.uidA);
    await w.type(2);
    await w.drain(1_200);
    const inBase = w.text;
    await w.type(2);
    const lastWords = w.text;
    expect(lastWords, 'набор после отсрочки обязан отличаться от строки базы').not.toBe(inBase);

    const recovered = await w.reloadStale();


    expect(recovered, `строка базы=${JSON.stringify(inBase)}, потеряно=${JSON.stringify(lastWords.slice(inBase.length))}`)
      .toBe(lastWords);
    expect(w.violations, report(w)).toEqual([]);
    w.unmount();
  });

  /**
   * НАХОДКА DW-F-2 (гость, форма строки). У гостя в один и тот же адрес
   * (`jw_guest_draft`) пишут два писателя с РАЗНЫМ набором полей:
   * `GuestDraftService.saveGuestDraftToStorage` (`GuestDraftService.ts:27`)
   * кладёт и `savedDocumentId`, и счётчики, а `useSyncUnloadSave`
   * (`useDraftCore.ts:243`) — только текст, тайминг и сессию. При возврате
   * гостевое чтение (`draftWriter.resolve`, `{ guest: true }`) берёт новейший по
   * `updatedAt` и ПЕРЕПИСЫВАЕТ им строку IndexedDB, то есть уход со страницы
   * после автосохранения затирает маркер продолженной заметки.
   *
   * Цена — не потеря текста, а потеря идентичности: `applyDraftToStores`
   * (`draftUtils.ts:28`) ставит `savedDocumentId: null`, и следующее сохранение
   * идёт по ветке «новой заметки» (`useWritingActions.ts:220-223`) — ещё одна
   * заметка с тем же текстом вместо версии прежней.
   *
   * Страж: обе записи обязаны нести одну полную форму — маркер продолженной
   * заметки и счётчики переживают уход со страницы.
   */
  it('DW-F-2 (гость): уход со страницы сохраняет маркер продолженной заметки и счётчики', async () => {
    const w = new World(9_002);
    await w.openGuest();
    useSessionMetaStore.getState().setSavedDocumentId('dw-f2-note');
    useTimerStore.setState({ accumulatedDuration: 77, totalPauseSeconds: 5 });
    useContentStore.getState().setInitialWordCount(3);
    await w.type(2);
    await w.drain(1_300);
    const rich = await settle(resolve(w.guestUid, { guest: true }));
    expect(rich?.savedDocumentId, 'после отсрочки маркер продолженной заметки есть').toBe('dw-f2-note');
    const autosaveRow = JSON.parse(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT) ?? '{}') as Record<string, unknown>;
    await w.pageHide();
    const after = await settle(resolve(w.guestUid, { guest: true }));
    const unloadRow = JSON.parse(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(unloadRow), 'обе записи несут одну форму')
      .toEqual(expect.arrayContaining(Object.keys(autosaveRow)));
    expect(after?.savedDocumentId, 'после ухода со страницы маркер должен остаться').toBe('dw-f2-note');
    expect(after?.accumulatedDuration, 'накопленное время не теряется').toBe(77);
    expect(after?.totalPauseSeconds, 'секунды паузы не теряются').toBe(5);
    expect(after?.initialWordCount, 'исходное число слов не теряется').toBe(3);
    expect(after?.content, 'текст не теряется').toBe(w.text);
    w.unmount();
  });

  /**
   * DW4-1 (шаг 1, утверждение 1): после ухода со страницы `jw_guest_draft`
   * несёт те же поля, что строка IDB `guest_draft`. Обе записи гостя идут через
   * один сериализатор (`draftWriter.ts`), поэтому расхождение форм невозможно по
   * построению. На коде до DW4-1 тест красный: у записи при закрытии есть
   * `status`, у строки отсрочки его нет — две формы одного адреса.
   */
  it('DW4-1: после ухода гостя jw_guest_draft и строка IDB несут одну форму', async () => {
    const w = new World(9_007);
    await w.openGuest();
    useSessionMetaStore.getState().setSavedDocumentId('dw41-note');
    useTimerStore.setState({ accumulatedDuration: 11, totalPauseSeconds: 2 });
    useContentStore.getState().setInitialWordCount(3);
    await w.type(2);
    await w.drain(1_300);
    const idbRow = await (await getLocalDb()).get('drafts', 'guest_draft') as Record<string, unknown> | undefined;
    expect(idbRow, 'отсрочка записала строку IDB').toBeDefined();
    await w.pageHide();
    const lsRow = JSON.parse(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT) ?? 'null') as Record<string, unknown> | null;
    expect(lsRow, 'уход со страницы записал jw_guest_draft').not.toBeNull();
    const idbFields = Object.keys(idbRow as object).filter(k => k !== 'userId').sort();
    const lsFields = Object.keys(lsRow as object).sort();
    expect(lsFields, 'обе записи гостя несут одну форму — один сериализатор').toEqual(idbFields);
    for (const f of ['savedDocumentId', 'accumulatedDuration', 'totalPauseSeconds', 'initialWordCount']) {
      expect(lsRow?.[f], `поле ${f} в снимке закрытия — как в строке IDB`).toEqual((idbRow as Record<string, unknown>)[f]);
    }
    w.unmount();
  });

  /**
   * DW4-1 (шаг 1, утверждение 2): следующее после ухода сохранение даёт ВЕРСИЮ
   * прежней заметки — маркер продолженной заметки пережил уход и возврат, и
   * ветка «сохранить» идёт в обновление той же строки: в `documents` ровно одна
   * заметка (числом), в ней весь набранный текст, и он же лежит в `versions`.
   * Цена обратного (маркер потерян) — вторая заметка с тем же текстом.
   */
  it('DW4-1: после ухода гостя следующее сохранение — версия прежней заметки, в documents одна', async () => {
    const w = new World(9_008);
    await w.openGuest();
    await w.type(2);
    await w.drain(1_300);
    await w.saveNote();
    // `World.saveNote` заканчивается resetSession() — id первой заметки берём
    // из самого стора documents.
    const db = await getLocalDb();
    const firstDocs = await db.getAll('documents');
    const firstId = firstDocs.length === 1 && firstDocs[0] ? String(firstDocs[0].id) : null;
    expect(firstId, 'первое сохранение создало ровно одну заметку').toBeTruthy();
    // Состояние продолженной заметки — то, которое держит окно сохранения
    // (порядок handleSave: метка → стирание черновика → сброс сессии; d34a):
    // маркер в мете, автосохранение уносит его в строку.
    useSessionMetaStore.getState().setSavedDocumentId(firstId as string);
    await w.type(2);
    const finalText = w.text;
    await w.pageHide();
    await w.reload();
    const marker = useSessionMetaStore.getState().savedDocumentId;
    expect(marker, 'маркер продолженной заметки пережил уход и возврат').toBe(firstId);
    // Ветка «Сохранить» из useWritingActions: маркер есть — обновление, нет —
    // новая заметка (ровно развилка DW-F-2).
    const saveData = {
      title: '', content: finalText, wordCount: 4, duration: 10, wpm: 10, tags: [] as string[],
      sessionStartedAt: new Date(Date.now()),
    };
    if (marker) {
      await settle(LocalStorageService.saveVersionToLocal(db, marker, saveData, Date.now()));
    } else {
      await settle(LocalStorageService.saveNew(w.guestUid, saveData));
    }
    const docs = await db.getAll('documents');
    expect(docs.length, 'в documents ровно одна заметка — версия, а не вторая заметка').toBe(1);
    // Текст живёт в versions; принадлежность прежней заметке — по documentId.
    const versions = await db.getAll('versions');
    const finalVersion = versions.find(v => v.documentId === firstId && v.content === finalText);
    expect(finalVersion, 'набранное после ухода лежит версией прежней заметки').toBeDefined();
    w.unmount();
  });

  it.each(SEEDS)('сид %i (аккаунт): инварианты I1–I5 не нарушены', async (seed) => {
    const w = await runAccountSeed(seed, 16);
    expect(w.violations, report(w)).toEqual([]);
    w.unmount();
  });

  it.each(GUEST_SEEDS)('сид %i (гость): инварианты I1, I4 не нарушены', async (seed) => {
    const w = await runGuestSeed(seed, 12);
    expect(w.violations, report(w)).toEqual([]);
    w.unmount();
  });

  // Храповик харнесса, а не цель: значения — факт этого прогона, округлённый
  // вниз. Падай он обязан, если писатели перестали вызываться (например, после
  // переезда черновика на «одного писателя» тесты поедут, а покрытие путей — нет).
  it('храповик харнесса: писатели и наблюдения считаются', () => {
    expect(tally.observations, 'наблюдений за перезагрузками').toBeGreaterThanOrEqual(80);
    expect(tally.recoveredNonEmpty, 'наблюдений с восстановленным текстом').toBeGreaterThanOrEqual(35);
    expect(tally.sawIdbRow, 'наблюдений со строкой в IndexedDB').toBeGreaterThanOrEqual(12);
    expect(tally.sawGuest, 'наблюдений с гостевым черновиком').toBeGreaterThanOrEqual(5);
    expect(env.cloudSaves, 'облачных записей черновика').toBeGreaterThanOrEqual(10);
    expect(env.cloudDeletes, 'облачных удалений черновика').toBeGreaterThanOrEqual(30);
  });
});
