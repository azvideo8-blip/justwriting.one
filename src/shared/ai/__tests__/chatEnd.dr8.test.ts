// DR-8: почему подробный ответ встал на середине слова? Нужна одна служебная
// строка на ход: finish, ms, out_tokens — размеры и перечисление, ни символа
// пользовательского текста.
import { describe, expect, it, vi } from 'vitest';
import { chatEndReason, chatEndRecorder, type ChatEndSignals } from '../chatShape';

const M_NOTE = 'МАРКЕР-ТЕЛА-ЗАМЕТКИ';

describe('DR-8: причина окончания хода — перечисление', () => {
  const cases: Array<[string, ChatEndSignals]> = [
    ['client_abort', { clientClosed: true, providerError: true, timedOut: true, providerFinish: 'stop', outTokens: 5, maxTokens: 3000 }],
    ['provider_error', { clientClosed: false, providerError: true, timedOut: false, providerFinish: null, outTokens: 5, maxTokens: 3000 }],
    ['deadline', { clientClosed: false, providerError: false, timedOut: true, providerFinish: null, outTokens: 5, maxTokens: 3000 }],
    ['length', { clientClosed: false, providerError: false, timedOut: false, providerFinish: 'length', outTokens: 1200, maxTokens: 3000 }],
    ['length', { clientClosed: false, providerError: false, timedOut: false, providerFinish: null, outTokens: 3000, maxTokens: 3000 }],
    ['stop', { clientClosed: false, providerError: false, timedOut: false, providerFinish: 'stop', outTokens: 700, maxTokens: 3000 }],
  ];
  it.each(cases)('%s при таких сигналах', (expected, signals) => {
    expect(chatEndReason(signals)).toBe(expected);
  });

  it('ушёл клиент, хотя провайдер дописал ответ — виден уход', () => {
    expect(chatEndReason({
      clientClosed: true, providerError: false, timedOut: false, providerFinish: 'stop', outTokens: 900, maxTokens: 3000,
    })).toBe('client_abort');
  });

  it('строка журнала содержит только поля finish, ms и out_tokens', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const rec = chatEndRecorder(Date.now() - 1200);
      rec({
        clientClosed: false, providerError: false, timedOut: false, providerFinish: 'stop',
        outTokens: 1305, maxTokens: 3000, noteText: M_NOTE, title: M_NOTE,
      } as never);
      expect(info).toHaveBeenCalledTimes(1);
      const line = String(info.mock.calls[0]![1]);
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(['finish', 'ms', 'out_tokens']);
      expect(parsed.finish).toBe('stop');
      expect(parsed.out_tokens).toBe(1305);
      expect(Number(parsed.ms)).toBeGreaterThanOrEqual(1200);
      expect(line).not.toContain(M_NOTE);
    } finally {
      info.mockRestore();
    }
  });

  it('повторный вызов на том же ходе ничего не печатает', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const rec = chatEndRecorder(Date.now());
      const signals = {
        clientClosed: false, providerError: false, timedOut: false, providerFinish: 'stop', outTokens: 10, maxTokens: 3000,
      };
      rec(signals);
      rec({ ...signals, clientClosed: true });
      expect(info).toHaveBeenCalledTimes(1);
    } finally {
      info.mockRestore();
    }
  });
});
