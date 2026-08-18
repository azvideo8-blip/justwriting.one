import { LegalPage } from './LegalPage';
import { TERMS } from './legalContent';

export function TermsOfServicePage() {
  return (
    <LegalPage
      doc={TERMS}
      path="/terms"
      titleRu="Условия использования"
      titleEn="Terms of Use"
      descriptionRu="Условия пользования justwriting: что делает сервис, что происходит с вашими записями и за что отвечает пользователь."
      descriptionEn="Terms of using justwriting: what the service does, what happens to your notes and what the user is responsible for."
    />
  );
}
