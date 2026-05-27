import { useState, useEffect, useRef } from 'react';

export function useTypewriter(text: string, speed = 18): { displayed: string; isTyping: boolean } {
  const [displayed, setDisplayed] = useState(text);
  const [isTyping, setIsTyping] = useState(false);
  const prevTextRef = useRef(text);
  const offsetRef = useRef(text.length);
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef(speed);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const prev = prevTextRef.current;
    if (text === prev) return;

    const isAppend = text.length > prev.length && text.startsWith(prev);

    if (isAppend) {
      offsetRef.current = prev.length;
    } else {
      offsetRef.current = text.length;
      prevTextRef.current = text;
      return;
    }

    prevTextRef.current = text;

    const tick = () => {
      const charsPerFrame = Math.max(1, Math.ceil(speedRef.current / 60));
      offsetRef.current = Math.min(offsetRef.current + charsPerFrame, text.length);
      const done = offsetRef.current >= text.length;

      setDisplayed(text.slice(0, offsetRef.current));
      setIsTyping(!done);

      if (done) {
        rafRef.current = null;
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [text]);

  return { displayed, isTyping };
}
