import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCallReservation, acquireChatReservation, REFUND_IF_PRODUCED_UNDER_CHARS } from '../../src/shared/ai/aiPolicy.js';
import type { AiContext, GlobalReservation } from '../../src/shared/ai/context.js';

describe('DUP-1: reservationLifetime', () => {
  let refundDailyMock: ReturnType<typeof vi.fn>;
  let refundBulkMock: ReturnType<typeof vi.fn>;
  let refundGlobalMock: ReturnType<typeof vi.fn>;
  let recordUsageMock: ReturnType<typeof vi.fn>;
  let checkDailyMock: ReturnType<typeof vi.fn>;
  let checkBulkMock: ReturnType<typeof vi.fn>;
  let reserveGlobalMock: ReturnType<typeof vi.fn>;
  let ctx: AiContext;

  const mockGlobalRes: GlobalReservation = {
    date: '2026-09-07',
    shardId: '0',
    allowance: 8192,
  };

  beforeEach(() => {
    refundDailyMock = vi.fn().mockResolvedValue(undefined);
    refundBulkMock = vi.fn().mockResolvedValue(undefined);
    refundGlobalMock = vi.fn().mockResolvedValue(undefined);
    recordUsageMock = vi.fn().mockResolvedValue(undefined);
    checkDailyMock = vi.fn().mockResolvedValue({ ok: true, day: '2026-09-07' });
    checkBulkMock = vi.fn().mockResolvedValue({ ok: true, day: '2026-09-07' });
    reserveGlobalMock = vi.fn().mockResolvedValue(mockGlobalRes);

    ctx = {
      refundDailyLimit: refundDailyMock,
      refundBulkLimit: refundBulkMock,
      refundGlobalRequest: refundGlobalMock,
      checkAndIncrementLimit: checkDailyMock,
      checkDailyLimit: checkDailyMock,
      checkAndIncrementBulkLimit: checkBulkMock,
      tryReserveGlobalRequest: reserveGlobalMock,
      recordUsage: recordUsageMock,
    } as unknown as AiContext;
  });

  it('exit: done without errors does not refund slot or global reservation', async () => {
    const res = createCallReservation(ctx, 'user_1', 'user', '2026-09-07', mockGlobalRes);
    res.markProduced(300);
    await res.settle('done');

    expect(refundDailyMock).not.toHaveBeenCalled();
    expect(refundBulkMock).not.toHaveBeenCalled();
    expect(refundGlobalMock).not.toHaveBeenCalled();
    expect(res.outcome).toBe('done');
  });

  it('exit: done with usage records usage to global reservation', async () => {
    const res = createCallReservation(ctx, 'user_1', 'user', '2026-09-07', mockGlobalRes);
    res.markProduced(300);
    await res.settle('done', { tokensIn: 150, tokensOut: 100, model: 'test-model' });

    expect(refundDailyMock).not.toHaveBeenCalled();
    expect(recordUsageMock).toHaveBeenCalledWith('user_1', 150, 100, { fn: 'chat-stream', model: 'test-model' }, mockGlobalRes);
  });

  it('exit: provider error (failed) before output refunds both slot and global reservation', async () => {
    const res = createCallReservation(ctx, 'user_1', 'user', '2026-09-07', mockGlobalRes);
    await res.settle('failed');

    expect(refundDailyMock).toHaveBeenCalledWith('user_1', '2026-09-07');
    expect(refundGlobalMock).toHaveBeenCalledWith(mockGlobalRes);
    expect(res.refunded).toBe(true);
    expect(res.outcome).toBe('failed');
  });

  it('exit: bulk charge provider error refunds bulk limit', async () => {
    const res = createCallReservation(ctx, 'user_bulk', 'bulk', '2026-09-07', mockGlobalRes);
    await res.settle('failed');

    expect(refundBulkMock).toHaveBeenCalledWith('user_bulk', '2026-09-07');
    expect(refundDailyMock).not.toHaveBeenCalled();
    expect(refundGlobalMock).toHaveBeenCalledWith(mockGlobalRes);
  });

  it('exit: aborted early (0 chars) refunds slot and idle global reservation', async () => {
    const res = createCallReservation(ctx, 'user_1', 'user', '2026-09-07', mockGlobalRes);
    await res.settle('abort');

    expect(refundDailyMock).toHaveBeenCalledTimes(1);
    expect(refundGlobalMock).toHaveBeenCalledTimes(1);
    expect(res.outcome).toBe('abort');
  });

  it('exit: aborted mid-stream under threshold (< 200 chars) refunds slot and reconciles global tokens with estimatedInputTokens (FU-4)', async () => {
    const estimatedInput = 1200;
    const res = createCallReservation(ctx, 'user_1', 'user', '2026-09-07', mockGlobalRes, estimatedInput);
    res.markProduced(60); // 60 chars produced (< 200) -> 20 output tokens
    await res.settle('abort');

    // User gets refund because answer was too short to be useful (< 200 chars)
    expect(refundDailyMock).toHaveBeenCalledTimes(1);
    // Upstream consumed tokens, so full global quota is not refunded via refundGlobalRequest
    expect(refundGlobalMock).not.toHaveBeenCalled();
    // FU-4: Reconciled with estimatedInputTokens instead of 0
    expect(recordUsageMock).toHaveBeenCalledWith(
      'user_1',
      1200,
      20,
      { fn: 'chat-stream-abort' },
      mockGlobalRes,
    );
  });

  it('exit: closed mid-stream under threshold (< 200 chars) refunds slot and reconciles global reservation', async () => {
    const estimatedInput = 500;
    const res = createCallReservation(ctx, 'user_1', 'user', '2026-09-07', mockGlobalRes, estimatedInput);
    res.markProduced(90); // 90 chars -> 30 tokensOut
    await res.settle('closed');

    expect(refundDailyMock).toHaveBeenCalledTimes(1);
    expect(refundGlobalMock).not.toHaveBeenCalled();
    expect(recordUsageMock).toHaveBeenCalledWith(
      'user_1',
      500,
      30,
      { fn: 'chat-stream-abort' },
      mockGlobalRes,
    );
  });

  it('exit: mid-stream over threshold (>= 200 chars) does NOT refund slot on close or abort (FU-5)', async () => {
    // 1. closed >= 200
    const resClosed = createCallReservation(ctx, 'user_1', 'user', '2026-09-07', mockGlobalRes, 800);
    resClosed.markProduced(REFUND_IF_PRODUCED_UNDER_CHARS); // 200 chars
    await resClosed.settle('closed');

    expect(refundDailyMock).not.toHaveBeenCalled();
    expect(refundGlobalMock).not.toHaveBeenCalled();
    expect(recordUsageMock).toHaveBeenCalledWith(
      'user_1',
      800,
      Math.ceil(200 / 3),
      { fn: 'chat-stream-abort' },
      mockGlobalRes,
    );

    // 2. abort >= 200
    const resAbort = createCallReservation(ctx, 'user_2', 'user', '2026-09-07', mockGlobalRes, 800);
    resAbort.markProduced(300);
    await resAbort.settle('abort');

    expect(refundDailyMock).not.toHaveBeenCalled();
    expect(refundGlobalMock).not.toHaveBeenCalled();
    expect(recordUsageMock).toHaveBeenCalledWith(
      'user_2',
      800,
      100,
      { fn: 'chat-stream-abort' },
      mockGlobalRes,
    );
  });

  it('double-settle is an idempotent no-op', async () => {
    const res = createCallReservation(ctx, 'user_1', 'user', '2026-09-07', mockGlobalRes);
    await res.settle('failed');
    await res.settle('failed');
    await res.settle('done');

    expect(refundDailyMock).toHaveBeenCalledTimes(1);
    expect(refundGlobalMock).toHaveBeenCalledTimes(1);
  });

  it('attachGlobalReservation links global reservation and releases it on failure', async () => {
    const res = createCallReservation(ctx, 'user_1', 'user', '2026-09-07');
    res.attachGlobalReservation(mockGlobalRes);
    await res.settle('failed');

    expect(refundDailyMock).toHaveBeenCalledTimes(1);
    expect(refundGlobalMock).toHaveBeenCalledWith(mockGlobalRes);
  });

  it('acquireChatReservation acquires slot and rolls back via callRes.settle when global reservation fails', async () => {
    const callRes = await acquireChatReservation(ctx, 'user_1', false);
    expect(checkDailyMock).toHaveBeenCalledTimes(1);
    expect(callRes.uid).toBe('user_1');
    expect(callRes.charge).toBe('user');
    expect(callRes.day).toBe('2026-09-07');

    // When global reservation fails, callRes.settle('failed') rolls back the slot
    const callRes2 = await acquireChatReservation(ctx, 'user_1', false);
    await callRes2.settle('failed');
    expect(refundDailyMock).toHaveBeenCalledWith('user_1', '2026-09-07');
  });
});
