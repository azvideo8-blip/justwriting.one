import { getLocalDb } from '../../../core/storage/localDb';
import { reportError } from '../../../shared/errors/reportError';
import { withUserRun } from './AIBackgroundBudget';
import { AIProfileFacetService } from './AIProfileFacetService';
import { AIFacetJudgeService } from './AIFacetJudgeService';
import { AIProfileService } from './AIProfileService';
import { AIThemeLedgerService, getPendingThemeTouches } from './AIThemeLedgerService';
import { AIMonthlyDigestService } from './AIMonthlyDigestService';
import { AIConsolidationService } from './AIConsolidationService';

/**
 * Обновление профиля — единственный способ пересчитать производные ИИ.
 *
 * Раньше портрет, грани, реестр тем, дайджесты и консолидация собирались
 * фоновым проходом, который сам ходил к поставщику. Прохода больше нет
 * (D4.23), и вместо него человек нажимает кнопку в «Обо мне», заранее видя,
 * во сколько вызовов это обойдётся и сколько останется от дневного лимита.
 *
 * Все вызовы внутри помечаются `charge: 'user'` и списываются с того же
 * дневного лимита, что и чат: обновление не должно быть бесплатным.
 */

/** Сколько примерно длится один вызов, с учётом пауз между ними. */
const SECONDS_PER_CALL = 6;

/** Судья пакует грани по три в вызов (или по объёму — тогда чаще). */
const FACETS_PER_JUDGE_CALL = 3;

/** Консолидация тратит два вызова на кластер: формулировка и проверка. */
const CALLS_PER_CLUSTER = 2;

export interface RefreshEstimate {
  /** Разбивка по шагам: что и во сколько вызовов обойдётся. */
  steps: { key: RefreshStepKey; calls: number }[];
  totalCalls: number;
  /** Грубая оценка длительности в секундах. */
  seconds: number;
}

export type RefreshStepKey = 'facets' | 'judge' | 'portrait' | 'themes' | 'digests' | 'consolidation';

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

    // Реестр тем разбирает очередь заметок, разобранных с прошлого раза.
    // Стоимость — по одному вызову на каждую тему, которой в реестре ещё нет:
    // знакомые темы берутся из кеша векторов и не стоят ничего.
    const known = new Set((await db.getAll('aiThemeLedger')).map(t => t.theme));
    const pending = getPendingThemeTouches();
    const freshThemes = new Set<string>();
    for (const docId of pending) {
      const summary = await db.get('aiSummaries', docId);
      for (const theme of summary?.themes ?? []) {
        if (theme && !known.has(theme)) freshThemes.add(theme);
      }
    }

    const digests = await countDigestMonths();

    // Кластеры считаем по тем же данным, что и сам проход, но без вызовов.
    let clusters = 0;
    try {
      const units = await AIConsolidationService.gatherMemoryUnits();
      clusters = units.length < 2 ? 0 : AIConsolidationService.clusterMemoryUnits(units).length;
    } catch (e) {
      reportError(e, { action: 'profileRefresh_estimateClusters' }, 'warning');
    }

    const all: { key: RefreshStepKey; calls: number }[] = [
      { key: 'facets', calls: needSummary },
      { key: 'judge', calls: judgeCalls },
      { key: 'portrait', calls: 1 },
      { key: 'themes', calls: freshThemes.size },
      { key: 'digests', calls: digests },
      { key: 'consolidation', calls: clusters * CALLS_PER_CLUSTER },
    ];
    const steps = all.filter(s => s.calls > 0);

    const totalCalls = steps.reduce((sum, s) => sum + s.calls, 0);
    return { steps, totalCalls, seconds: totalCalls * SECONDS_PER_CALL };
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
        await step('themes', () => AIThemeLedgerService.processPendingThemeTouches());
        await step('digests', async () => {
          const db = await getLocalDb();
          const timeline = await db.getAll('aiTimeline');
          const months = [...new Set(timeline.map(e => e.month).filter(Boolean))].sort();
          for (const month of months) {
            await AIMonthlyDigestService.generateForMonth(month, chargeOpt);
          }
        });
        await step('consolidation', () => AIConsolidationService.processConsolidationPass(chargeOpt));
        // Портрет последним: он читает уже пересчитанные и проверенные грани.
        await step('portrait', () => AIProfileService.generate(chargeOpt));
      });
    } finally {
      setRunningStep(null);
    }

    return { failed };
  },
};
