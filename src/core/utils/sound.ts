let _audioCtx: AudioContext | null = null;

export function playGoalSound() {
  try {
    const AudioCtx = typeof window.AudioContext === 'function' ? window.AudioContext : (window as Window & typeof globalThis & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (_audioCtx == null) _audioCtx = new AudioCtx();

    const audioCtx = _audioCtx;
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }

    const frequencies = [396, 528];

    frequencies.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.type = 'sine';
      osc.frequency.value = freq;

      const startTime = audioCtx.currentTime + i * 0.08;

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 3.5);

      osc.start(startTime);
      osc.stop(startTime + 3.5);
    });
  } catch {
    // silent fail — browser may block AudioContext without user gesture
  }
}
