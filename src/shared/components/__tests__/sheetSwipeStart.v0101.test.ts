// 0.10.1 (просьба владельца): лист закрывается свайпом вниз. Начать свайп можно
// с любого места листа, кроме поля ввода и прокручиваемого блока не в самом верху
// (там свайп прокручивает содержимое). Мутации: убрать проверку поля или
// прокрутки → красный соответствующий кейс.
import { describe, it, expect } from 'vitest';
import { canStartSheetDrag, shouldDismissSheet } from '../ModalShell';

function sheet(): { root: HTMLElement; list: HTMLElement; row: HTMLElement; input: HTMLInputElement } {
  const root = document.createElement('div');
  const list = document.createElement('div');
  const row = document.createElement('button');
  const input = document.createElement('input');
  list.appendChild(row);
  root.append(list, input);
  document.body.appendChild(root);
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 900 });
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 400 });
  return { root, list, row, input };
}

describe('свайп листа: откуда можно начать', () => {
  it('с заголовка или строки — можно', () => {
    const { root, row } = sheet();
    expect(canStartSheetDrag(root, root)).toBe(true);
    expect(canStartSheetDrag(row, root)).toBe(true);
  });

  it('из поля ввода — нельзя', () => {
    const { root, input } = sheet();
    expect(canStartSheetDrag(input, root)).toBe(false);
  });

  it('из прокрученного вниз списка — нельзя; список в самом верху — можно', () => {
    const { root, list, row } = sheet();
    list.scrollTop = 120;
    expect(canStartSheetDrag(row, root)).toBe(false);
    list.scrollTop = 0;
    expect(canStartSheetDrag(row, root)).toBe(true);
  });

  // Ревью 0.10.1: щелчок без расстояния не закрывает лист — набранное название цело.
  it('a fast flick needs at least 24 px; a long slow drag still closes', () => {
    expect(shouldDismissSheet(12, 900)).toBe(false);
    expect(shouldDismissSheet(30, 900)).toBe(true);
    expect(shouldDismissSheet(90, 0)).toBe(true);
    expect(shouldDismissSheet(60, 100)).toBe(false);
  });
});
