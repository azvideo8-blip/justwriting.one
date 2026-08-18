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

  it('returns CallReservation object', async () => {
    const ctx = ctxSpy();
    const res = await chargeCall(ctx, 'uid_1', 'user');
    expect(res).toEqual({ uid: 'uid_1', charge: 'user', refunded: false });
  });

  it('refunds to the same counter it charged with CallReservation', async () => {
    const ctx = ctxSpy();
    const res = await chargeCall(ctx, 'uid_1', 'user');
    await refundCall(ctx, res);
    expect(ctx.refundDailyLimit).toHaveBeenCalledTimes(1);
    expect(res.refunded).toBe(true);

    // Second call is idempotent — does not refund again
    await refundCall(ctx, res);
    expect(ctx.refundDailyLimit).toHaveBeenCalledTimes(1);
  });

  it('refunds bulk counter with CallReservation idempotently', async () => {
    const ctx = ctxSpy();
    const res = await chargeCall(ctx, 'uid_1', 'bulk');
    await refundCall(ctx, res);
    expect(ctx.refundBulkLimit).toHaveBeenCalledTimes(1);
    expect(res.refunded).toBe(true);

    // Second call is idempotent — does not refund again
    await refundCall(ctx, res);
    expect(ctx.refundBulkLimit).toHaveBeenCalledTimes(1);
  });

  it('handles null and undefined gracefully', async () => {
    const ctx = ctxSpy();
    await refundCall(ctx, null);
    await refundCall(ctx, undefined);
    expect(ctx.refundDailyLimit).not.toHaveBeenCalled();
    expect(ctx.refundBulkLimit).not.toHaveBeenCalled();
  });
});

