import { describe, it, expect, vi } from 'vitest';
import { parseCharge, chargeCall, refundCall } from '../ai/policy';
import type { AiContext } from '../ai/context';

/**
 * Пометка `charge` приходит от клиента, поэтому важно ровно одно: подделать ею
 * можно только удорожание. Всё, что не равно строке 'user', обязано означать
 * фоновый лимит — иначе появился бы способ обойти дневной счётчик.
 */
function ctxSpy() {
  return {
    checkDailyLimit: vi.fn().mockResolvedValue(true),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue(true),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
  } as unknown as AiContext & {
    checkDailyLimit: ReturnType<typeof vi.fn>;
    refundDailyLimit: ReturnType<typeof vi.fn>;
    checkAndIncrementBulkLimit: ReturnType<typeof vi.fn>;
    refundBulkLimit: ReturnType<typeof vi.fn>;
  };
}

describe('parseCharge', () => {
  it('treats everything except the literal marker as the background limit', () => {
    expect(parseCharge('user')).toBe('user');
    for (const value of [undefined, null, '', 'bulk', 'USER', 0, 1, true, {}, ['user']]) {
      expect(parseCharge(value)).toBe('bulk');
    }
  });
});

describe('chargeCall', () => {
  it('charges the daily limit for a user-initiated call', async () => {
    const ctx = ctxSpy();
    await chargeCall(ctx, 'uid_1', 'user');
    expect(ctx.checkDailyLimit).toHaveBeenCalledWith('uid_1');
    expect(ctx.checkAndIncrementBulkLimit).not.toHaveBeenCalled();
  });

  it('charges the background limit by default', async () => {
    const ctx = ctxSpy();
    await chargeCall(ctx, 'uid_1', 'bulk');
    expect(ctx.checkAndIncrementBulkLimit).toHaveBeenCalledWith('uid_1');
    expect(ctx.checkDailyLimit).not.toHaveBeenCalled();
  });

  it('refuses the call once the daily limit is spent', async () => {
    const ctx = ctxSpy();
    ctx.checkDailyLimit.mockResolvedValue(false);
    await expect(chargeCall(ctx, 'uid_1', 'user')).rejects.toThrow('Daily limit reached.');
  });

  it('refunds to the same counter it charged', async () => {
    const ctx = ctxSpy();
    await refundCall(ctx, 'uid_1', 'user');
    expect(ctx.refundDailyLimit).toHaveBeenCalledWith('uid_1');
    expect(ctx.refundBulkLimit).not.toHaveBeenCalled();
  });
});
