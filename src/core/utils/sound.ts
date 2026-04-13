export function playGoalSound() {
  try {
    const ctx = new (window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

    // Два тихих обертона — как тибетская чаша
    const frequencies = [396, 528];

    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.value = freq;

      const startTime = ctx.currentTime + i * 0.08;

      // Очень плавное нарастание — 300ms, потом долгое затухание
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 3.5);

      osc.start(startTime);
      osc.stop(startTime + 3.5);
    });

    setTimeout(() => ctx.close(), 4000);
  } catch {
    // silent fail
  }
}
