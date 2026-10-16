/**
 * MC-6: копирование и скачивание кода восстановления — один код на окно
 * (RecoveryCodeDisplayModal) и на степпер первого входа. Имя файла и текст
 * самого файла юридические: если они разъедутся по двум поверхностям,
 * доказывать придётся два разных артефакта.
 */
import { downloadBlob } from '../utils/downloadBlob';

export async function copyRecoveryCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * R7Q-011: отзыв object URL в том же тике, что и `a.click()`, оставлял
 * WebKit/Android WebView без файла — скачивание стартует позже, а поверхность
 * уже докладывала «сохранено» и стирала единственный код. `downloadBlob`
 * откладывает отзыв на секунду ровно для этого.
 */
export function downloadRecoveryCode(code: string, t: (k: string) => string): boolean {
  try {
    const fileContent = `${t('enc_recovery_file_header')}\n\n${code}\n\n${t('enc_recovery_file_footer')}`;
    downloadBlob(new Blob([fileContent], { type: 'text/plain;charset=utf-8' }), 'justwriting-recovery-code.txt');
    return true;
  } catch {
    return false;
  }
}
