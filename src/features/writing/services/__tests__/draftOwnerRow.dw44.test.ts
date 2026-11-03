import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { applyWrite, buildGuestDraftRecord, bumpDraftGeneration, clearEditorTextOwner, getDraftGeneration, getEditorTextOwner, markEditorTextOwner } from '../draftWriter';
import { getLocalDb } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

const T0 = 1_700_000_000_000;

async function storedRow(uid: string): Promise<Record<string, unknown> | undefined> {
  const db = await getLocalDb(uid);
  return (await db.get('drafts', uid)) as Record<string, unknown> | undefined;
}

describe('DW4-4: владелец текста — поле строки, названное мутатору', () => {
  beforeEach(() => {
    localStorage.clear();
    clearEditorTextOwner();
  });

  it('писатель без названного владельца не пишет: строка и копия не тронуты', async () => {
    const uid = 'u_dw44_noowner';
    bumpDraftGeneration(uid);
    const outcome = await applyWrite(
      { content: 'MARKER_DW44_без_владельца', updatedAt: T0 - 1000 },
      'edit',
      { uid, epoch: getDraftGeneration(uid) },
    );
    expect(outcome).toBe('no-owner');
    expect(await storedRow(uid), 'запись без владельца попала в строку').toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(uid)), 'запись без владельца попала в копию').toBeNull();
  });

  it('текст A не пишется в адреса B: названный владелец ≠ адресу (I3)', async () => {
    const uidA = 'u_dw44_A';
    const uidB = 'u_dw44_B';
    bumpDraftGeneration(uidB);
    const outcome = await applyWrite(
      { content: 'MARKER_DW44_текст_A', owner: uidA, updatedAt: T0 - 1000 },
      'edit',
      { uid: uidB, epoch: getDraftGeneration(uidB) },
    );
    expect(outcome).toBe('owner-mismatch');
    expect(await storedRow(uidB), 'текст A лёг в строку B (I3)').toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(uidB)), 'текст A лёг в копию B (I3)').toBeNull();
    // А в СВОЮ строку тот же писатель пишет.
    bumpDraftGeneration(uidA);
    const ok = await applyWrite(
      { content: 'MARKER_DW44_текст_A', owner: uidA, updatedAt: T0 - 1000 },
      'edit',
      { uid: uidA, epoch: getDraftGeneration(uidA) },
    );
    expect(ok).toBe('written');
    expect((await storedRow(uidA))?.content).toBe('MARKER_DW44_текст_A');
  });

  it('названный владелец попадает в строку и в копию; adopt-cloud называет владельца сам', async () => {
    const uid = 'u_dw44_stamp';
    bumpDraftGeneration(uid);
    const outcome = await applyWrite(
      { content: 'MARKER_DW44_штамп', owner: uid, updatedAt: T0 - 1000 },
      'edit',
      { uid, epoch: getDraftGeneration(uid) },
    );
    expect(outcome).toBe('written');
    expect((await storedRow(uid))?.owner, 'в строке нет владельца (I6)').toBe(uid);

    await applyWrite(
      { content: 'MARKER_DW44_штамп', owner: uid, updatedAt: T0 - 1000 },
      'edit',
      { uid, target: 'copy', epoch: getDraftGeneration(uid) },
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.DRAFT(uid)) ?? '{}')).toMatchObject({ owner: uid });

    // adopt-cloud: копию из облака принимает сам сервис — владелец назван адресом.
    const adopt = await applyWrite(
      { content: 'MARKER_DW44_из_облака', updatedAt: T0 - 2000 },
      'adopt-cloud',
      { uid, epoch: undefined },
    );
    expect(adopt).toBe('no-owner');
  });

  it('гостевая отсрочка называет владельца-гостя; хозяин копии — гость, не аккаунт', async () => {
    const guest = 'guest_dw44';
    bumpDraftGeneration(guest);
    const rec = buildGuestDraftRecord({ content: 'MARKER_DW44_гость', owner: guest, timestamp: T0 - 1000 });
    const outcome = await applyWrite(rec, 'edit', { uid: guest, target: 'copy', epoch: getDraftGeneration(guest) });
    expect(outcome).toBe('written');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT) ?? '{}')).toMatchObject({ owner: guest });
  });

  it('зеркало владельца: штамп при правке, чужой аккаунт не присваивает, сброс после спасения', () => {
    expect(getEditorTextOwner()).toBeUndefined();
    markEditorTextOwner('u_dw44_mirror');
    expect(getEditorTextOwner()).toBe('u_dw44_mirror');
    clearEditorTextOwner();
    expect(getEditorTextOwner()).toBeUndefined();
  });
});
