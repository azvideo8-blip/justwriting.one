const BUDGET_KEY = 'ai_bg_budget';
const DAILY_BUDGET = 60;

export function getBudgetUsage(): { date: string; spent: number } {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    if (!raw) return { date: new Date().toISOString().slice(0, 10), spent: 0 };
    const parsed = JSON.parse(raw);
    if (parsed.date !== new Date().toISOString().slice(0, 10)) {
      return { date: new Date().toISOString().slice(0, 10), spent: 0 };
    }
    return parsed;
  } catch {
    return { date: new Date().toISOString().slice(0, 10), spent: 0 };
  }
}

export const AIBackgroundBudget = {
  canSpend(weight: number): boolean {
    const usage = getBudgetUsage();
    return usage.spent + weight <= DAILY_BUDGET;
  },

  spend(weight: number): void {
    const usage = getBudgetUsage();
    try {
      localStorage.setItem(
        BUDGET_KEY,
        JSON.stringify({ date: usage.date, spent: usage.spent + weight })
      );
    } catch {
      // localStorage unavailable — usage tracking is best-effort, fail open
    }
  },

  budgetStatus(): { spent: number; budget: number } {
    const usage = getBudgetUsage();
    return { spent: usage.spent, budget: DAILY_BUDGET };
  }
};
