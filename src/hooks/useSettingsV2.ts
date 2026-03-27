import { useState, useEffect } from 'react';

export const useSettingsV2 = () => {
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('v2_fontFamily') || 'Inter');
  const [textWidth, setTextWidth] = useState<'centered' | 'full'>(() => (localStorage.getItem('v2_textWidth') as 'centered' | 'full') || 'centered');
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('v2_fontSize')) || 18);
  const [zenMode, setZenMode] = useState(() => localStorage.getItem('v2_zenModeEnabled') === 'true');
  const [stickyHeader, setStickyHeader] = useState(() => localStorage.getItem('v2_stickyHeaderEnabled') !== 'false');
  const [headerVisibility, setHeaderVisibility] = useState(() => {
    const saved = localStorage.getItem('v2_headerVisibility');
    return saved ? JSON.parse(saved) : {
      currentTime: true,
      sessionTime: true,
      sessionWords: true,
      totalWords: true,
      wpm: true,
    };
  });

  useEffect(() => {
    localStorage.setItem('v2_fontFamily', fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    localStorage.setItem('v2_textWidth', textWidth);
  }, [textWidth]);

  useEffect(() => {
    localStorage.setItem('v2_fontSize', fontSize.toString());
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem('v2_zenModeEnabled', zenMode.toString());
  }, [zenMode]);

  useEffect(() => {
    localStorage.setItem('v2_stickyHeaderEnabled', stickyHeader.toString());
  }, [stickyHeader]);

  useEffect(() => {
    localStorage.setItem('v2_headerVisibility', JSON.stringify(headerVisibility));
  }, [headerVisibility]);

  const toggleVisibility = (key: string) => {
    setHeaderVisibility((prev: any) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  return {
    fontFamily,
    setFontFamily,
    textWidth,
    setTextWidth,
    fontSize,
    setFontSize,
    zenMode,
    setZenMode,
    stickyHeader,
    setStickyHeader,
    headerVisibility,
    toggleVisibility,
  };
};
