/** TR-4: ручной запуск знакомства. Слушает `AppShell`, шлют пункты «Как всё устроено». */
export const TOUR_START_EVENT = 'jw:tour-start';

export function startTour(): void {
  window.dispatchEvent(new Event(TOUR_START_EVENT));
}
