import { AsyncLocalStorage } from 'node:async_hooks';
import { vi } from 'vitest';
import { Device } from './harnessDevice';

const context = new AsyncLocalStorage<ChaosTab>();
const nativeNow = Date.now;
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const nativeSetInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;
type Timer = ReturnType<typeof setTimeout>;

export class ChaosDevice extends Device {
  offline = false;
  skew = 0;
  readonly locks = new Map<string, { owner: ChaosTab; release: () => void }>();
  readonly waiters = new Map<string, Array<() => void>>();
}

export class ChaosTab {
  alive = true;
  readonly timers = new Set<Timer>();
  readonly windowEvents = new EventTarget();
  readonly documentEvents = new EventTarget();
  readonly session = new Map<string, string>();
  constructor(public device: ChaosDevice) {}

  run<T>(fn: () => T): T { return context.run(this, fn); }

  close(): void {
    this.alive = false;
    for (const timer of this.timers) { nativeClearTimeout(timer); nativeClearInterval(timer); }
    this.timers.clear();
    for (const lock of this.device.locks.values()) if (lock.owner === this) lock.release();
  }
}

function storage(map: () => Map<string, string>): Storage {
  return {
    get length() { return map().size; },
    key: n => [...map().keys()][n] ?? null,
    getItem: key => map().get(key) ?? null,
    setItem: (key, value) => { map().set(String(key), String(value)); },
    removeItem: key => { map().delete(key); },
    clear: () => { map().clear(); },
  };
}

export class ChaosBrowser {
  readonly tabs = new Set<ChaosTab>();
  elapsed = 0;
  fallback: ChaosTab | undefined;
  private restores: Array<() => void> = [];
  private tab(): ChaosTab {
    const tab = context.getStore() ?? this.fallback;
    if (!tab) throw new Error('Browser operation without a tab');
    return tab;
  }

  createTab(device: ChaosDevice): ChaosTab {
    const tab = new ChaosTab(device);
    this.tabs.add(tab);
    return tab;
  }

  now = (): number => nativeNow() + this.elapsed + this.tab().device.skew;
  serverNow = (): number => nativeNow() + this.elapsed;

  install(): void {
    const property = (target: object, name: string, get: () => unknown) => {
      const previous = Object.getOwnPropertyDescriptor(target, name);
      Object.defineProperty(target, name, { configurable: true, get });
      this.restores.push(() => {
        if (previous) Object.defineProperty(target, name, previous);
        else Reflect.deleteProperty(target, name);
      });
    };
    property(globalThis, 'indexedDB', () => this.tab().device.factory);
    property(globalThis, 'localStorage', () => storage(() => this.tab().device.storage));
    property(globalThis, 'sessionStorage', () => storage(() => this.tab().session));
    property(navigator, 'onLine', () => !this.tab().device.offline);
    property(navigator, 'locks', () => ({ request: (name: string, callback: () => unknown) => {
      const tab = this.tab();
      return new Promise((resolve, reject) => {
        const enter = () => {
          if (!tab.alive) { tab.device.waiters.get(name)?.shift()?.(); return; }
          const release = () => {
            if (tab.device.locks.get(name)?.release !== release) return;
            tab.device.locks.delete(name);
            tab.device.waiters.get(name)?.shift()?.();
          };
          tab.device.locks.set(name, { owner: tab, release });
          void tab.run(() => Promise.resolve().then(() => tab.alive ? callback() : new Promise(() => {})).then(resolve, reject).finally(release));
        };
        if (!tab.device.locks.has(name)) enter();
        else {
          const waiters = tab.device.waiters.get(name) ?? [];
          waiters.push(enter);
          tab.device.waiters.set(name, waiters);
        }
      });
    } }));
    for (const [target, events] of [[window, 'windowEvents'], [document, 'documentEvents']] as const) {
      vi.spyOn(target, 'addEventListener').mockImplementation((...args) => this.tab()[events].addEventListener(...args));
      vi.spyOn(target, 'removeEventListener').mockImplementation((...args) => this.tab()[events].removeEventListener(...args));
      vi.spyOn(target, 'dispatchEvent').mockImplementation(event => this.tab()[events].dispatchEvent(event));
    }
    // The tested flows use direct unlock notifications; no cross-device native Node channels.
    property(globalThis, 'BroadcastChannel', () => undefined);
    const schedule = (repeat: boolean, handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      const tab = context.getStore() ?? this.fallback;
      const timer = (repeat ? nativeSetInterval : nativeSetTimeout)(() => {
        if (!repeat) tab?.timers.delete(timer);
        if (!tab) handler(...args);
        else if (tab.alive) tab.run(() => handler(...args));
      }, delay);
      tab?.timers.add(timer);
      return timer;
    };
    globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => schedule(false, handler, delay, ...args)) as typeof setTimeout;
    globalThis.setInterval = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => schedule(true, handler, delay, ...args)) as typeof setInterval;
    Date.now = this.now;
  }

  close(): void {
    for (const tab of this.tabs) tab.alive = false;
    for (const tab of this.tabs) tab.close();
    this.tabs.clear();
    this.restores.reverse().forEach(restore => restore());
    this.restores = [];
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.setInterval = nativeSetInterval;
    Date.now = nativeNow;
  }
}
