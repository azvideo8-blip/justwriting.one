import { z } from 'zod';
import { useWritingSettings } from '../../writing/contexts/WritingSettingsContext';
import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';

export const useSettingsV2 = () => {
  const [fontFamily, setFontFamily] = useLocalStorage<string>(
    'v2_fontFamily', 
    'Inter',
    z.string()
  );
  const [textWidth, setTextWidth] = useLocalStorage<'centered' | 'full'>(
    'v2_textWidth', 
    'centered',
    z.enum(['centered', 'full'])
  );
  const [fontSize, setFontSize] = useLocalStorage<number>(
    'v2_fontSize', 
    18,
    z.number()
  );
  const { zenModeEnabled: zenMode, setZenModeEnabled: setZenMode } = useWritingSettings();
  const [stickyHeader, setStickyHeader] = useLocalStorage<boolean>(
    'v2_stickyHeaderEnabled', 
    true,
    z.boolean()
  );
  const [headerVisibility, setHeaderVisibility] = useLocalStorage<any>(
    'v2_headerVisibility', 
    {
      currentTime: true,
      sessionTime: true,
      sessionWords: true,
      totalWords: true,
      wpm: true,
    },
    z.object({
      currentTime: z.boolean(),
      sessionTime: z.boolean(),
      sessionWords: z.boolean(),
      totalWords: z.boolean(),
      wpm: z.boolean(),
    })
  );

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
