import { describe, expect, it } from 'vitest';
import { addressFormOf, ADDRESS_FORM_LINES } from '../addressForm';
import { summaryTurnDue, SUMMARY_TURN_LINE } from '../summaryTurn';
import { assembleChatPromptParams, buildChatSystemPrompt } from '../buildChatPrompt';

const u = (content: string) => ({ role: 'user', content });
const a = (content: string) => ({ role: 'assistant', content });

describe('К25-1: обращение решает код', () => {
  it('человек пишет на «ты» — «ты», даже если портрет говорит «вы» (случай #25)', () => {
    expect(addressFormOf([u('Слушай, разбери мне эту запись, что ты видишь?')], '## Стиль общения\nОбращаться на «вы».')).toBe('ty');
  });

  it('человек пишет на «вы» — «вы»', () => {
    expect(addressFormOf([u('Скажите, что вы думаете об этой записи?')], null)).toBe('vy');
  });

  it('по репликам не видно — что в портрете; иначе «ты»', () => {
    expect(addressFormOf([u('Разбор записи')], 'Предпочитает обращение на «вы».')).toBe('vy');
    expect(addressFormOf([u('Разбор записи')], null)).toBe('ty');
  });

  it('чужая речь в кавычках — не обращение к собеседнику', () => {
    expect(addressFormOf([u('Она сказала: «вы опять всё перепутали». Обидно.')], null)).toBe('ty');
  });

  it('строка обращения — последней в промпте, поверх портрета', () => {
    const p = buildChatSystemPrompt({ ...assembleChatPromptParams({ personaId: 'cbt', messages: [u('Разбери, что ты видишь')], userPortrait: '## Стиль общения\nОбращаться на «вы».' }), rnd: () => 0 });
    expect(p.endsWith(ADDRESS_FORM_LINES.ty)).toBe(true);
  });

  it('английская реплика и Редактор — без строки', () => {
    const en = buildChatSystemPrompt({ ...assembleChatPromptParams({ personaId: 'cbt', messages: [u('What do you see in this note?')] }), rnd: () => 0 });
    expect(en).not.toContain('ОБРАЩЕНИЕ В ЭТОМ ДИАЛОГЕ');
    const ed = buildChatSystemPrompt({ ...assembleChatPromptParams({ personaId: 'editor', messages: [u('Сделай пост')] }), rnd: () => 0 });
    expect(ed).not.toContain('ОБРАЩЕНИЕ В ЭТОМ ДИАЛОГЕ');
  });
});

describe('К23-2/К25-2: итог после серии ответов-вопросов', () => {
  const series = (n: number) => Array.from({ length: n }, (_, i) => [u(`реплика ${i}`), a(`отражение ${i}. Что ты чувствуешь?`)]).flat();

  it('три ответа-вопроса подряд, человек ничего не спросил — итог', () => {
    expect(summaryTurnDue([...series(3), u('Да, наверное, так и есть')])).toBe(true);
  });

  it('два — ещё рано', () => {
    expect(summaryTurnDue([...series(2), u('Да')])).toBe(false);
  });

  it('человек спросил или попросил — не итог', () => {
    expect(summaryTurnDue([...series(3), u('А что мне с этим делать?')])).toBe(false);
    expect(summaryTurnDue([...series(3), u('Посоветуй что-нибудь')])).toBe(false);
  });

  it('ответ без вопроса обрывает серию', () => {
    expect(summaryTurnDue([...series(3), u('ок'), a('Понимаю.'), u('да')])).toBe(false);
  });

  it('после хода с итогом серия считается заново, даже если итог кончился «верно?»', () => {
    const afterSummary = [...series(3), u('Да'), a('Итак, ты заметил вот что. Верно я собрал?')];
    expect(summaryTurnDue([...afterSummary, u('Верно')])).toBe(false);
  });

  it('строка итога в промпте; не в кризис и не у Редактора', () => {
    const msgs = [...series(3), u('Да, так и есть')];
    const build = (personaId: string, crisis = false) => buildChatSystemPrompt({ ...assembleChatPromptParams({ personaId, messages: msgs, crisis }), rnd: () => 0 });
    expect(build('cbt')).toContain(SUMMARY_TURN_LINE);
    expect(build('cbt', true)).not.toContain(SUMMARY_TURN_LINE);
    expect(build('editor')).not.toContain(SUMMARY_TURN_LINE);
  });
});

import { auditAnswer } from '../answerAudit';

describe('К25-3: счётчик «о записи» без опоры на её текст', () => {
  const DOC = '[Прикреплена заметка: "Звонок"]\nВечером позвонила сестре, договорились встретиться в субботу у вокзала. Разговор вышел спокойный, без обид.';
  it('приписывание записи того, чего в ней нет, — считается', () => {
    const answer = 'В записи ты пишешь, что прямо попросить о помощи тебе даже не приходило в голову. Что ты об этом думаешь?';
    expect(auditAnswer(answer, DOC)!.attached_claim_weak).toBe(1);
  });
  it('пересказ записи её словами — не считается', () => {
    const answer = 'В записи ты пишешь, что позвонила сестре и вы договорились встретиться в субботу у вокзала. Как тебе после разговора?';
    expect(auditAnswer(answer, DOC)!.attached_claim_weak).toBe(0);
  });
  it('честное «в записи этого нет» — не считается', () => {
    expect(auditAnswer('В записи ты пишешь только про звонок, а о помощи в ней ничего нет.', DOC)!.attached_claim_weak).toBe(0);
    expect(auditAnswer('В записи не сказано, просила ли ты о помощи прямо.', DOC)!.attached_claim_weak).toBe(0);
  });
  it('без приложенной заметки — 0', () => {
    expect(auditAnswer('В записи ты пишешь, что прямо попросить о помощи не приходило в голову.', 'Результаты поиска по архиву заметок\n[#a · 2026-11-01]\nтекст')!.attached_claim_weak).toBe(0);
  });
});

import { RELATED_DAYS_HEAD } from '../quoteGuard';

describe('К26-4: счётчик «прошлые дни без ссылки»', () => {
  const DOC = `[#n1 · 20261118]\n[Прикреплена заметка: "Ночь"]\nСпала плохо, всё раздражает.\n\n${RELATED_DAYS_HEAD}\n[#n0 · 20261115] суть: тоже не спала перед сдачей проекта`;
  it('фон есть, указание без ссылки → 1', () => {
    expect(auditAnswer('В недавних записях ты тоже писал про усталость и работу.', DOC)!.related_no_ref).toBe(1);
    expect(auditAnswer('Раньше вы писали о похожем.', DOC)!.related_no_ref).toBe(1);
  });
  it('со ссылкой → 0', () => {
    expect(auditAnswer('В недавних записях ты тоже писал про усталость [#n0].', DOC)!.related_no_ref).toBe(0);
  });
  it('фона нет → 0', () => {
    expect(auditAnswer('В недавних записях ты тоже писал про усталость.', DOC.split(RELATED_DAYS_HEAD)[0]!)!.related_no_ref).toBe(0);
  });
});
