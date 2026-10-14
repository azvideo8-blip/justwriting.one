/**
 * MC-6: копирование и скачивание кода восстановления — один код на окно
 * (RecoveryCodeDisplayModal) и на степпер первого входа. Имя файла и текст
 * самого файла юридические: если они разъедутся по двум поверхностям,
 * доказывать придётся два разных артефакта.
 */
export async function copyRecoveryCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}

export function downloadRecoveryCode(code: string, t: (k: string) => string): boolean {
  try {
    const fileContent = `${t('enc_recovery_file_header')}\n\n${code}\n\n${t('enc_recovery_file_footer')}`;
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'justwriting-recovery-code.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
