import { getLocalDb } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';
import { withUserRun } from './AIBackgroundBudget';
import { AIProfileFacetService } from './AIProfileFacetService';
import { AIFacetJudgeService } from './AIFacetJudgeService';
import { AIProfileService } from './AIProfileService';
import { AIMonthlyDigestService } from './AIMonthlyDigestService';

/**
 * Обновление профиля — единственный способ пересчитать производные ИИ.
 *
 * Раньше портрет, грани, реестр тем, дайджесты и консолидация собирались
 * фоновым проходом, который сам ходил к поставщику. Прохода больше нет
 * (D4.23), и вместо него человек нажимает кнопку в «Обо мне», заранее видя,
 * во сколько вызовов это обойдётся и сколько останется от дневного лимита.
 *
 * Вызовы внутри помечаются `charge: 'user'` и списываются с того же дневного
 * лимита, что и чат: обновление не должно быть бесплатным. Кроме портрета (MB-11):
 * его разделы идут служебным чатом (`callType: 'system_task'`), обработчик чата
 * `charge` не читает и списывает их из служебного пула `internal_chat`, а не
 * из квоты человека — поэтому в `limitCalls` они не входят.
 */

/** Сколько примерно длится один вызов, с учётом пауз между ними. */
const SECONDS_PER_CALL = 6;

/** Разделов портрета (AIProfileService.generate); перегенерируются только изменившиеся. */
const PORTRAIT_SECTIONS = 5;

/** Судья пакует грани по три в вызов (или по объёму — тогда чаще). */
const FACETS_PER_JUDGE_CALL = 3;


export interface RefreshEstimate {
  /** Разбивка по шагам: что и во сколько вызовов обойдётся. */
  steps: { key: RefreshStepKey; calls: number }[];
  totalCalls: number;
  /** Сколько из них спишется с дневного лимита человека (без портрета — он из служебного пула). */
  limitCalls: number;
  /** Грубая оценка длительности в секундах. */
  seconds: number;
}

export type RefreshStepKey = 'facets' | 'judge' | 'portrait' | 'digests';

export interface RefreshProgress {
  step: RefreshStepKey;
  done: number;
  total: number;
}

async function countDigestMonths(): Promise<number> {
  const db = await getLocalDb();
  const timeline = await db.getAll('aiTimeline');
  const digests = await db.getAll('aiMonthlyDigest');
  const fresh = new Set(
    digests
      .filter(d => Date.now() - d.generatedAt < 24 * 60 * 60 * 1000)
      .map(d => d.month),
  );
  const months = new Set(timeline.map(e => e.month).filter(Boolean));
  return [...months].filter(m => !fresh.has(m)).length;
}

let _runningStep: RefreshStepKey | null = null;
const _subscribers = new Set<(step: RefreshStepKey | null) => void>();

function setRunningStep(step: RefreshStepKey | null) {
  _runningStep = step;
  _subscribers.forEach(cb => cb(step));
}

export const AIProfileRefreshService = {
  isRunning(): boolean {
    return _runningStep !== null;
  },

  getCurrentStep(): RefreshStepKey | null {
    return _runningStep;
  },

  subscribe(callback: (step: RefreshStepKey | null) => void): () => void {
    _subscribers.add(callback);
    return () => {
      _subscribers.delete(callback);
    };
  },

  /**
   * Считает стоимость, ничего не выполняя и никуда не обращаясь. Числа
   * приблизительные: судья пакует грани по объёму, а консолидация может
   * остановиться раньше — поэтому в интерфейсе они показаны как «примерно».
   */
  async estimate(): Promise<RefreshEstimate> {
    const db = await getLocalDb();
    const facets = await db.getAll('aiProfileFacets');
    const needSummary = facets.filter(f => f.dirty || f.pendingSummary).length;
    const judgeCalls = facets.length > 0 ? Math.ceil(facets.length / FACETS_PER_JUDGE_CALL) : 0;

    const digests = await countDigestMonths();

    const all: { key: RefreshStepKey; calls: number }[] = [
      { key: 'facets', calls: needSummary },
      { key: 'judge', calls: judgeCalls },
      { key: 'portrait', calls: PORTRAIT_SECTIONS },
      { key: 'digests', calls: digests },
    ];
    const steps = all.filter(s => s.calls > 0);

    const totalCalls = steps.reduce((sum, s) => sum + s.calls, 0);
    const limitCalls = totalCalls - PORTRAIT_SECTIONS;
    return { steps, totalCalls, limitCalls, seconds: totalCalls * SECONDS_PER_CALL };
  },

  /**
   * Выполняет пересчёт. Шаги идут по возрастанию зависимости: сперва грани и
   * их проверка, потом портрет, который эти грани читает.
   *
   * Один шаг, упавший с ошибкой, не роняет остальные: обновление стоит денег,
   * и терять уже оплаченную работу из-за отказа на четвёртом шаге незачем.
   */
  async run(onProgress?: (p: RefreshProgress) => void): Promise<{ failed: RefreshStepKey[] }> {
    if (_runningStep !== null) {
      throw new Error('AI profile refresh is already in progress');
    }

    setRunningStep('facets');
    const failed: RefreshStepKey[] = [];

    const step = async (key: RefreshStepKey, fn: () => Promise<unknown>) => {
      setRunningStep(key);
      onProgress?.({ step: key, done: 0, total: 1 });
      try {
        await fn();
      } catch (e) {
        failed.push(key);
        reportError(e, { action: `profileRefresh_${key}` });
      }
      onProgress?.({ step: key, done: 1, total: 1 });
    };

    try {
      await withUserRun(async () => {
        const chargeOpt = { charge: 'user' as const };
        await step('facets', async () => {
          await AIProfileFacetService.resummarizeDirty(undefined, chargeOpt);
          await AIProfileFacetService.summarizePending(undefined, chargeOpt);
        });
        await step('judge', () => AIFacetJudgeService.review(chargeOpt));
        await step('digests', async () => {
          const db = await getLocalDb();
          const timeline = await db.getAll('aiTimeline');
          const months = [...new Set(timeline.map(e => e.month).filter(Boolean))].sort();
          for (const month of months) {
            await AIMonthlyDigestService.generateForMonth(month, chargeOpt);
          }
        });
        // Портрет последним: он читает уже пересчитанные и проверенные грани.
        await step('portrait', () => AIProfileService.generate(chargeOpt));
      });
    } finally {
      setRunningStep(null);
    }

    return { failed };
  },
};
