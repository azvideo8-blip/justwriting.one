import { LegalPage } from './LegalPage';
import { PRIVACY_POLICY } from './legalContent';

export function PrivacyPolicyPage() {
  return (
    <LegalPage
      doc={PRIVACY_POLICY}
      path="/privacy"
      titleRu="Политика обработки персональных данных"
      titleEn="Personal Data Processing Policy"
      descriptionRu="Какие данные обрабатывает justwriting, с какой целью, на каком основании, где они хранятся и как их удалить."
      descriptionEn="What data justwriting processes, for what purpose, on what grounds, where it is stored and how to delete it."
    />
  );
}
