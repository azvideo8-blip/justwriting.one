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

// Обновление профиля запускает человек, и платит он за него из своего дневного
// лимита на сервере. Фоновый губернатор здесь не при делах: он сдерживал проход,
// который шёл сам по себе, а такого прохода больше нет. Без этой поблажки
// обновление молча не делало бы ничего при исчерпанном фоновом бюджете.
let userRun = false;

/** Внутри — работа, заказанная человеком: фоновый бюджет не ограничивает. */
export async function withUserRun<T>(fn: () => Promise<T>): Promise<T> {
  const previous = userRun;
  userRun = true;
  try {
    return await fn();
  } finally {
    userRun = previous;
  }
}

export const AIBackgroundBudget = {
  canSpend(weight: number): boolean {
    if (userRun) return true;
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
