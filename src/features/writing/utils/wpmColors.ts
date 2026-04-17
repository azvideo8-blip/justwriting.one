export function getWpmColor(wpm: number): string {
  if (wpm === 0) return 'bg-text-main/20';      // серый
  if (wpm < 15)  return 'bg-red-500';           // красный
  if (wpm < 25)  return 'bg-orange-500';        // оранжевый
  if (wpm < 35)  return 'bg-yellow-500';        // жёлтый
  if (wpm < 50)  return 'bg-emerald-500';       // зелёный
  return 'bg-blue-400';                          // синий — очень быстро
}
