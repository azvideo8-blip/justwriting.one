// К21-4 (случай #21, 21.2): ответ в ходе с выдачей пересказывает записи, но не
// ссылается ни на одну. Правило одно для сервера и клиента — общий модуль
// notesRefRule: счётчик в строку журнала и пометка под ответом обязаны
// срабатывать на одних и тех же формах. Фикстуры синтетические.
import { describe, expect, it } from 'vitest';
import { hasResultsDelivery, notesClaimWithoutRef } from '../notesRefRule';
import { auditAnswer } from '../answerAudit';

const DELIVERY = [
  'Результаты поиска по архиву заметок',
  'Найдено заметок: 2.',
  '[#local_k214_a · 12.10.2026]',
  'Заметка 1: "Утренняя смена"',
  'Подъём в шесть, дорога пустая.',
  '[#local_k214_b · 14.10.2026]',
  'Заметка 2: "Разговор с сестрой"',
  'Сестра приедет в выходные.',
].join('\n');
const EMPTY_DELIVERY = 'Результаты поиска по архиву заметок\nНайдено заметок: 0.';
const NO_DELIVERY = '[Прикреплена заметка: "Утренняя смена"]\nПодъём в шесть, дорога пустая.';

const CLAIM = 'В записях ты писал про подъём в шесть, а про сестру — что она приедет.';
const CLAIM_WITH_REF = `${CLAIM} [#local_k214_a]`;
const NO_CLAIM = 'Похоже, утро было тяжёлым. Что с ним делать дальше?';

describe('К21-4: выдача в материалах видна правилу', () => {
  it('непустая выдача — да, пустая и ход без выдачи — нет', () => {
    expect(hasResultsDelivery(DELIVERY)).toBe(true);
    expect(hasResultsDelivery(EMPTY_DELIVERY)).toBe(false);
    expect(hasResultsDelivery(NO_DELIVERY)).toBe(false);
    expect(hasResultsDelivery(null)).toBe(false);
  });
});

describe('К21-4: пересказ записей без ссылки', () => {
  it('пересказ при выдаче без единой ссылки — признак есть', () => {
    expect(notesClaimWithoutRef(CLAIM, DELIVERY)).toBe(true);
  });

  it('со ссылкой — признака нет', () => {
    expect(notesClaimWithoutRef(CLAIM_WITH_REF, DELIVERY)).toBe(false);
  });

  it('без выдачи — признака нет, ссылаться не на что', () => {
    expect(notesClaimWithoutRef(CLAIM, EMPTY_DELIVERY)).toBe(false);
    expect(notesClaimWithoutRef(CLAIM, NO_DELIVERY)).toBe(false);
    expect(notesClaimWithoutRef(CLAIM, null)).toBe(false);
  });

  it('ответ без оборотов о записях — признака нет', () => {
    expect(notesClaimWithoutRef(NO_CLAIM, DELIVERY)).toBe(false);
    expect(notesClaimWithoutRef('', DELIVERY)).toBe(false);
  });

  it('формы тикета и свёртка регистра/ё', () => {
    const forms = [
      'В записях об этом ни слова.',
      'в заметке от 12 октября ты описал смену',
      'В тот же день ты вышел раньше.',
      'по записям видно, что утро было тяжёлым',
      'ТЫ ПИСАЛ ПРО ПОДЪЁМ В ШЕСТЬ',
      'в дневнике это описано иначе',
      'ты упоминала про дорогу',
    ];
    for (const answer of forms) expect(notesClaimWithoutRef(answer, DELIVERY), answer).toBe(true);
  });

  it('«в записях» вне хода с выдачей признака не даёт', () => {
    expect(notesClaimWithoutRef('В записях об этом ни слова.', NO_DELIVERY)).toBe(false);
  });
});

describe('К21-4: счётчик в аудите ответа', () => {
  it('пересказ без ссылок при выдаче — 1', () => {
    expect(auditAnswer(CLAIM, DELIVERY)?.notes_claim_no_ref).toBe(1);
  });

  it('со ссылкой — 0, без выдачи — 0', () => {
    expect(auditAnswer(CLAIM_WITH_REF, DELIVERY)?.notes_claim_no_ref).toBe(0);
    expect(auditAnswer(CLAIM, NO_DELIVERY)?.notes_claim_no_ref).toBe(0);
    expect(auditAnswer(CLAIM, EMPTY_DELIVERY)?.notes_claim_no_ref).toBe(0);
  });

  it('без материалов аудита нет вовсе', () => {
    expect(auditAnswer(CLAIM, null)).toBeNull();
  });

  it('счётчик не тянет в результат ни ответа, ни материалов', () => {
    const audit = auditAnswer(CLAIM, DELIVERY);
    expect(Object.values(audit ?? {}).every(v => typeof v === 'boolean' || typeof v === 'number')).toBe(true);
  });
});
