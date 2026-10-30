// Дейлик 30.10 Н-3 (DY10-3): после DY9-12 отказ по потолку «хода мысли» стал
// отдельным кодом REASONING_LIMIT, а классификатор журнала его не знал и писал
// «внутренняя ошибка ИИ» (error). Мутация: убрать REASONING_LIMIT из списка → красный.
import { describe, it, expect } from 'vitest';
import { classifyCause, isDailyLimitError } from '../aiDegradationReporter';

describe('DY10-3: лимит «хода мысли» — штатный дневной лимит, не сбой сервера', () => {
  it('REASONING_LIMIT распознаётся как дневной лимит и сохраняет свой код', () => {
    expect(isDailyLimitError('REASONING_LIMIT')).toBe(true);
    expect(isDailyLimitError({ code: 'REASONING_LIMIT' })).toBe(true);
    expect(classifyCause('REASONING_LIMIT')).toEqual({ category: 'daily_limit', code: 'REASONING_LIMIT' });
  });
  it('контроль: прежние коды не разъехались', () => {
    expect(classifyCause('DAILY_LIMIT')).toEqual({ category: 'daily_limit', code: 'DAILY_LIMIT' });
    expect(classifyCause('BULK_LIMIT')).toEqual({ category: 'daily_limit', code: 'BULK_LIMIT' });
    expect(classifyCause('RATE_LIMIT').category).toBe('transient');
  });
});
