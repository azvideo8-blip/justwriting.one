import { IDBFactory } from 'fake-indexeddb';
import { resetDbInstance } from '../../core/storage/localDb';

/**
 * «Устройство» стенда двух устройств: свой IndexedDB (отдельный fake
 * IDBFactory) и свой localStorage. `activateDevice` переключает вкладку так, чтобы
 * код приложения — один и тот же для всех устройств — читал хранилища того
 * устройства, под которым идёт шаг.
 *
 * SF2-4: хелпер вынесен из twoDevices.test.ts, потому что тот же цикл нужен
 * записям `local_store_records` (ИИ-данные), а не их дублю в втором файле.
 */
export class Device {
  readonly factory = new IDBFactory();
  readonly storage = new Map<string, string>();
  constructor(readonly name: string) {}
}

let current: Device | null = null;

export function activeDevice(): Device | null {
  return current;
}

export function activateDevice(dev: Device): void {
  if (current === dev) return;
  if (current) {
    current.storage.clear();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      current.storage.set(k, localStorage.getItem(k)!);
    }
  }
  localStorage.clear();
  for (const [k, v] of dev.storage) localStorage.setItem(k, v);
  resetDbInstance();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = dev.factory;
  current = dev;
}

/** Между тестами не оставляем «текущее устройство»: следующий старт с нуля. */
export function forgetDevice(): void {
  current = null;
}
