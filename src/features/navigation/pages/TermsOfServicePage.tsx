import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { Button } from '../../../shared/components/Button';

export function TermsOfServicePage() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const isRu = language === 'ru';

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <SeoHead
        path="/terms"
        titleRu="Условия использования — justwriting"
        titleEn="Terms of Service — justwriting"
        descriptionRu="Условия использования приложения justwriting. Ответственность, допустимое использование, права пользователя."
        descriptionEn="Terms of Service for justwriting app. Liability, acceptable use, user rights."
      />
      <Button
        onClick={() => void navigate(-1)}
        className="flex items-center gap-2 text-text-main/60 hover:text-text-main/60 text-sm mb-8 transition-colors"
      >
        <ArrowLeft size={16} />
        {isRu ? 'Назад' : 'Back'}
      </Button>

      <h1 className="text-2xl font-bold text-text-main mb-2">
        {isRu ? 'Условия использования' : 'Terms of Service'}
      </h1>
      <p className="text-sm text-text-main/60 mb-8">
        {isRu ? 'Последнее обновление: 18 июня 2026' : 'Last updated: June 18, 2026'}
      </p>

      <div className="space-y-6 text-sm text-text-main/70 leading-relaxed">
        {isRu ? (
          <>
            <section>
              <h2 className="text-base font-bold text-text-main mb-2">1. Принятие условий</h2>
              <p>Используя justwriting, вы соглашаетесь с настоящими условиями. Если вы не согласны, пожалуйста, не используйте приложение.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">2. Описание сервиса</h2>
              <p>justwriting — это минималистичный текстовый редактор для фрирайтинга и потокового письма. Приложение предоставляет инструменты для написания, хранения и анализа текстов, а также ИИ-функции для рефлексии и редактирования.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">3. Допустимое использование</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>Используйте приложение для личного письма, заметок и рефлексии.</li>
                <li>Не используйте приложение для незаконной деятельности.</li>
                <li>Не пытайтесь нарушить безопасность, взломать или атаковать сервис.</li>
                <li>Не используйте ИИ-функции для генерации вредоносного, оскорбительного или незаконного контента.</li>
                <li>Не злоупотребляйте ИИ-функциями (превышение лимитов, автоматизированные запросы).</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">4. ИИ-функции</h2>
              <p>ИИ-функции (чат, редактирование, саммаризация) предоставляются через сторонние API (Google Gemini, OpenRouter). ИИ-ответы носят рекомендательный характер и не являются профессиональной медицинской, психологической или юридической консультацией. Не полагайтесь на ИИ-ответы для принятия критических решений.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">5. Ваши данные</h2>
              <p>Вы сохраняете право собственности на все тексты, написанные в приложении. Вы несёте ответственность за содержание ваших записей. Мы не читаем и не используем ваши тексты без вашего явного согласия.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">6. Ограничение ответственности</h2>
              <p>Сервис предоставляется «как есть» без каких-либо гарантий. Мы не несём ответственности за потерю данных из-за сбоев браузера, устройства или облачного сервиса. Рекомендуем регулярно экспортировать важные записи.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">7. Изменения условий</h2>
              <p>Мы можем обновлять эти условия. Пользователи будут уведомлены о значительных изменениях при следующем входе в приложение.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">8. Удаление аккаунта</h2>
              <p>Вы можете удалить отдельные записи в любой момент. Полное удаление аккаунта будет доступно после технической миграции. До этого момента вы можете очистить локальные данные в настройках браузера.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">9. Возраст</h2>
              <p>Приложение предназначено для пользователей старше 16 лет.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">10. Контакты</h2>
              <p>По вопросам использования сервиса свяжитесь с нами через настройки приложения.</p>
            </section>
          </>
        ) : (
          <>
            <section>
              <h2 className="text-base font-bold text-text-main mb-2">1. Acceptance of Terms</h2>
              <p>By using justwriting, you agree to these terms. If you do not agree, please do not use the app.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">2. Service Description</h2>
              <p>justwriting is a minimalist text editor for freewriting and stream-of-consciousness writing. The app provides tools for writing, storing, and analyzing texts, as well as AI features for reflection and editing.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">3. Acceptable Use</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>Use the app for personal writing, notes, and reflection.</li>
                <li>Do not use the app for illegal activities.</li>
                <li>Do not attempt to breach security, hack, or attack the service.</li>
                <li>Do not use AI features to generate harmful, abusive, or illegal content.</li>
                <li>Do not abuse AI features (exceeding limits, automated requests).</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">4. AI Features</h2>
              <p>AI features (chat, editing, summarization) are provided through third-party APIs (Google Gemini, OpenRouter). AI responses are advisory in nature and are not professional medical, psychological, or legal advice. Do not rely on AI responses for critical decisions.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">5. Your Data</h2>
              <p>You retain ownership of all texts written in the app. You are responsible for the content of your entries. We do not read or use your texts without your explicit consent.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">6. Limitation of Liability</h2>
              <p>The service is provided &ldquo;as is&rdquo; without any warranties. We are not liable for data loss due to browser, device, or cloud service failures. We recommend regularly exporting important entries.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">7. Changes to Terms</h2>
              <p>We may update these terms. Users will be notified of significant changes upon next login.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">8. Account Deletion</h2>
              <p>You can delete individual entries at any time. Full account deletion will be available after the technical migration. Until then, you can clear local data in browser settings.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">9. Age</h2>
              <p>The app is intended for users over 16 years of age.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">10. Contact</h2>
              <p>For service inquiries, contact us through the app settings.</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
