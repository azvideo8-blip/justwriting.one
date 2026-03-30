import { useState, useEffect } from 'react';

export function useWritingSettings() {
  const [streamMode, setStreamMode] = useState<boolean>(() => {
    return localStorage.getItem('streamMode') === 'true';
  });
  const [zenModeEnabled, setZenModeEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('v2_zenModeEnabled');
    return saved === null ? true : saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('streamMode', streamMode.toString());
  }, [streamMode]);

  useEffect(() => {
    localStorage.setItem('v2_zenModeEnabled', zenModeEnabled.toString());
  }, [zenModeEnabled]);

  const toggleStreamMode = () => setStreamMode(prev => !prev);

  return { streamMode, toggleStreamMode, zenModeEnabled, setZenModeEnabled };
}
