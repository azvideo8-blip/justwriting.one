import { useEffect, useState } from 'react';

/** MQ-5: `true`, пока `open`, и ещё `ms` после закрытия — компонент листа остаётся
 *  смонтированным, и `ModalShell` успевает проиграть уход вниз вместо исчезновения
 *  за кадр. Дольше `exit` листа (200 мс). */
export function useExitLinger(open: boolean, ms = 250): boolean {
  const [lingering, setLingering] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setLingering(!open);
  }
  useEffect(() => {
    if (!lingering) return;
    const id = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(id);
  }, [lingering, ms]);
  return open || lingering;
}
