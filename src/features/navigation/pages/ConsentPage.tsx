import { LegalPage } from './LegalPage';
import { CONSENT } from './legalContent';

export function ConsentPage() {
  return (
    <LegalPage
      doc={CONSENT}
      path="/consent"
      titleRu="Согласие на обработку персональных данных"
      titleEn="Consent to Personal Data Processing"
      descriptionRu="Текст согласия, включая отдельное согласие на обработку специальных категорий персональных данных."
      descriptionEn="The consent text, including separate consent to the processing of special categories of personal data."
    />
  );
}
