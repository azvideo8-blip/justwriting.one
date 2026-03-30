import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';

export const useSettingsV2 = () => {
  const [fontFamily, setFontFamily] = useLocalStorage<string>('v2_fontFamily', 'Inter');
  const [textWidth, setTextWidth] = useLocalStorage<'centered' | 'full'>('v2_textWidth', 'centered');
  const [fontSize, setFontSize] = useLocalStorage<number>('v2_fontSize', 18);
  const { zenModeEnabled: zenMode, setZenModeEnabled: setZenMode } = useWritingSettings();
  const [stickyHeader, setStickyHeader] = useLocalStorage<boolean>('v2_stickyHeaderEnabled', true);
  const [headerVisibility, setHeaderVisibility] = useLocalStorage<any>('v2_headerVisibility', {
    currentTime: true,
    sessionTime: true,
    sessionWords: true,
    totalWords: true,
    wpm: true,
  });

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
