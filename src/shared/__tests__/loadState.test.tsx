// load-state-fable: ядро «загрузка / ошибка / пусто / частичный отказ».
// Каждое утверждение — один из классов дейликов 03.11–19.11.
// Мутации (прогнаны, каждая красит хотя бы один тест этого файла):
//  М1 — loadState.settled: убрать ветку cloudFailed            → «частичный отказ ≠ пусто»;
//  М2 — LoadStateView: в ветке error вернуть `empty`            → «сбой ≠ пусто»;
//  М4 — LoadStateView: error с прошлыми данными без notice      → «сбой перечитывания назван»;
//  М5 — mapLoadState: partial → settled(fn(data), isEmpty)      → «срез частичного не пуст».
// Чего мутацией не покрасить, потому что не компилируется (это и есть гарантия типа):
//  ошибка без retry; чтение data у error/loading; LoadStateView без ветки error или partial.
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LoadStateView } from '../components/LoadStateView';
import { knownData, loadState, mapLoadState, type LoadState } from '../loadState';

const noRows = (rows: string[]) => rows.length === 0;
const retry = vi.fn();

function view(state: LoadState<string[]>) {
  cleanup();
  render(
    <LoadStateView
      state={state}
      loading={<p>LOADING</p>}
      error={again => <button onClick={again}>ERROR</button>}
      partial={again => <button onClick={again}>CLOUD</button>}
      empty={<p>EMPTY</p>}
    >
      {(rows, notice) => <>{notice}<ul>{rows.map(r => <li key={r}>{r}</li>)}</ul></>}
    </LoadStateView>,
  );
  return ['LOADING', 'ERROR', 'CLOUD', 'EMPTY', 'MARKER_ROW'].filter(text => screen.queryByText(text));
}

describe('LoadStateView: «пусто» только после целиком удавшегося чтения', () => {
  it('сбой чтения — ошибка, а не «пусто»; повтор из состояния работает', () => {
    expect(view(loadState.error(retry))).toEqual(['ERROR']);
    fireEvent.click(screen.getByText('ERROR'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it('читаем — загрузка, а не «пусто»', () => {
    expect(view(loadState.loading())).toEqual(['LOADING']);
  });
  it('облако не прочиталось, локально ноль — плашка, а не «пусто»', () => {
    expect(view(loadState.settled([], noRows, { retry }))).toEqual(['CLOUD']);
  });
  it('прочитано целиком и пусто — «пусто»', () => {
    expect(view(loadState.settled([], noRows))).toEqual(['EMPTY']);
  });
  it('сбой перечитывания: прошлый список на месте, ошибка названа', () => {
    expect(view(loadState.error(retry, ['MARKER_ROW']))).toEqual(['ERROR', 'MARKER_ROW']);
  });
  it('перечитывание: прошлый список на месте, без «загрузки» и «пусто»', () => {
    expect(view(loadState.loading(['MARKER_ROW']))).toEqual(['MARKER_ROW']);
  });
  it('данные с частичным отказом — плашка и строки', () => {
    expect(view(loadState.settled(['MARKER_ROW'], noRows, { retry }))).toEqual(['CLOUD', 'MARKER_ROW']);
  });
  it('данные целиком — только строки', () => {
    expect(view(loadState.settled(['MARKER_ROW'], noRows))).toEqual(['MARKER_ROW']);
  });
});

describe('loadState: помощники', () => {
  it('settled: empty рождается только без отказа облака', () => {
    expect(loadState.settled([], noRows).status).toBe('empty');
    expect(loadState.settled([], noRows, { retry }).status).toBe('partial');
    expect(loadState.settled(['a'], noRows).status).toBe('data');
  });
  it('mapLoadState: срез целого может стать empty, срез частичного — нет', () => {
    const count = (rows: number[]) => rows.filter(n => n > 5);
    const none = (rows: number[]) => rows.length === 0;
    expect(mapLoadState<number[], number[]>({ status: 'data', data: [1, 2] }, count, none)).toEqual({ status: 'empty' });
    expect(mapLoadState<number[], number[]>({ status: 'data', data: [1, 9] }, count, none)).toEqual({ status: 'data', data: [9] });
    expect(mapLoadState<number[], number[]>({ status: 'partial', data: [1, 2], retry }, count, none)).toEqual({ status: 'partial', data: [], retry });
    expect(mapLoadState<number[], number[]>(loadState.error(retry, [9]), count, none)).toEqual({ status: 'error', retry, stale: [9] });
    expect(mapLoadState<number[], number[]>(loadState.loading(), count, none)).toEqual({ status: 'loading', stale: undefined });
  });
  it('knownData: свежие или прошлые', () => {
    expect(knownData<string>({ status: 'data', data: 'a' })).toBe('a');
    expect(knownData(loadState.error(retry, 'b'))).toBe('b');
    expect(knownData(loadState.loading<string>())).toBeUndefined();
    expect(knownData<string>({ status: 'empty' })).toBeUndefined();
  });
});

// 0.11.22: ошибка перечитывания над прошлыми данными — своим видом (строка), если
// задан errorWithData. Мутация: всегда error(retry) — красный.
describe('LoadStateView: errorWithData', () => {
  it('ошибка при прошлых данных — errorWithData, без прошлых — error', () => {
    cleanup();
    const props = {
      loading: 'L', partial: () => 'P', empty: 'E',
      error: () => 'BIG', errorWithData: () => 'ROW',
      children: (rows: string[], notice: ReactNode) => <div>{notice}{rows.join(',')}</div>,
    };
    const { rerender } = render(<LoadStateView<string[]> {...props} state={loadState.error(retry, ['a'])} />);
    expect(screen.getByText('ROWa')).toBeTruthy();
    rerender(<LoadStateView<string[]> {...props} state={loadState.error(retry)} />);
    expect(screen.getByText('BIG')).toBeTruthy();
  });
});

// Гарантии компилятора. Каждая строка под @ts-expect-error — ошибка, которую
// раньше ловил только аудит; если тип ослабнет, tsc упадёт на «лишней» пометке.
describe('loadState: чего тип не даёт написать', () => {
  it('ошибка без retry, данные без разбора состояния, экран без ветки error / partial', () => {
    // @ts-expect-error — ошибка без выхода не собирается
    const noRetry: LoadState<string[]> = { status: 'error', stale: undefined };
    // @ts-expect-error — «пусто» нельзя посчитать, не разобрав состояние (Н-1, Н-2)
    const countRows = (state: LoadState<string[]>) => state.data.length;
    const state = loadState.loading<string[]>();
    // @ts-expect-error — экран не может «забыть» ветку error
    const noError = <LoadStateView state={state} loading={null} partial={() => null} empty={null}>{() => null}</LoadStateView>;
    // @ts-expect-error — экран не может «забыть» частичный отказ
    const noPartial = <LoadStateView state={state} loading={null} error={() => null} empty={null}>{() => null}</LoadStateView>;
    expect([noRetry, countRows, noError, noPartial]).toHaveLength(4);
  });
});
