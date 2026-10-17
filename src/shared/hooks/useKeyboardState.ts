import { useEffect, useState } from 'react';

export interface KeyboardState {
  /** Насколько клавиатура налегает на layout-вьюпорт (0, если её нет): от его
   *  низа до верха клавиатуры — столько отступа нужно `fixed`-панели снизу. */
  overlay: number;
  /** Клавиатура есть — и как оверлей поверх вьюпорта, и как сжатие самого
   *  вьюпорта (так её эмулируют тесты и так же ведёт себя прячущийся адресный
   *  бар: `innerHeight` уменьшается вместе с `visualViewport.height`, и
   *  классический признак «innerHeight − vv.height» молчит). */
  up: boolean;
}

const KEYBOARD_MIN = 130;

/** MC-2: нижней панели нужно именно «клавиатура занимает низ экрана». Отдельный
 *  модуль — потому что `BottomNav` живёт в index-куске, а старый модуль
 *  `useKeyboardHeight` тянул бы туда ещё и свою подписку (бюджет CI). */
export function useKeyboardState(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({ overlay: 0, up: false });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let baseline = window.innerHeight;
    let baselineWidth = window.innerWidth;
    const measure = () => {
      // Поворот меняет ширину: прежняя «высота без клавиатуры» к новой ориентации
      // не относится. Без пересъёма в ландшафте панель вкладок пряталась без
      // клавиатуры (ревью 0.9.40). Клавиатура ширину не меняет.
      if (window.innerWidth !== baselineWidth) {
        baselineWidth = window.innerWidth;
        baseline = window.innerHeight;
      }
      baseline = Math.max(baseline, window.innerHeight);
      const vv = window.visualViewport;
      const vvHeight = vv ? vv.height : window.innerHeight;
      // iOS при открытой клавиатуре прокручивает видимую область к каретке
      // (offsetTop > 0): верх клавиатуры в координатах layout-вьюпорта — на
      // offsetTop ниже. Без этого панель висела над клавиатурой с пустой полосой
      // (снимок владельца, 0.10.0). Размер самой клавиатуры от прокрутки не зависит.
      const keyboard = window.innerHeight - vvHeight;
      const overlay = Math.max(0, keyboard - (vv ? vv.offsetTop : 0));
      const shrink = baseline - window.innerHeight;
      setState(prev => {
        const next: KeyboardState = { overlay, up: keyboard > KEYBOARD_MIN || shrink > KEYBOARD_MIN };
        return prev.up === next.up && prev.overlay === next.overlay ? prev : next;
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    // Прокрутка видимой области не шлёт resize.
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, []);

  return state;
}
