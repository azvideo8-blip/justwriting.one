import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../shared/i18n';
import { SeoHead } from '../../../shared/i18n/SeoHead';
import { Button } from '../../../shared/components/Button';

export function PrivacyPolicyPage() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const isRu = language === 'ru';

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <SeoHead
        path="/privacy"
        titleRu="Политика конфиденциальности — justwriting"
        titleEn="Privacy Policy — justwriting"
        descriptionRu="Как justwriting собирает, хранит и обрабатывает ваши данные. Шифрование, ИИ-функции, аналитика, права пользователя."
        descriptionEn="How justwriting collects, stores, and processes your data. Encryption, AI features, analytics, user rights."
      />
      <Button
        onClick={() => void navigate(-1)}
        className="flex items-center gap-2 text-text-main/60 hover:text-text-main/60 text-sm mb-8 transition-colors"
      >
        <ArrowLeft size={16} />
        {isRu ? 'Назад' : 'Back'}
      </Button>

      <h1 className="text-2xl font-bold text-text-main mb-2">
        {isRu ? 'Политика конфиденциальности' : 'Privacy Policy'}
      </h1>
      <p className="text-sm text-text-main/60 mb-8">
        {isRu ? 'Последнее обновление: 18 июня 2026' : 'Last updated: June 18, 2026'}
      </p>

      <div className="space-y-6 text-sm text-text-main/70 leading-relaxed">
        {isRu ? (
          <>
            <section>
              <h2 className="text-base font-bold text-text-main mb-2">1. Какие данные мы собираем</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Email</strong> — для регистрации и аутентификации.</li>
                <li><strong>Текстовые заметки</strong> — ваши записи, заголовки, теги, настроение.</li>
                <li><strong>Профиль</strong> — никнейм, статистика (кол-во слов, серия дней, достижения).</li>
                <li><strong>Метаданные ИИ</strong> — количество запросов, использованные токены, модель.</li>
                <li><strong>Технические данные</strong> — Web Vitals (CLS, FCP, INP, LCP, TTFB), ошибки в Sentry.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">2. Где хранятся данные</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Локально</strong> — в IndexedDB вашего браузера (local-first архитектура).</li>
                <li><strong>В облаке</strong> — в Firebase Firestore (Google, США) при включённой синхронизации.</li>
                <li><strong>ИИ-обработка</strong> — текст передаётся в OpenRouter для генерации ответов. Текст не сохраняется на наших серверах после обработки.</li>
                <li><strong>Аналитика</strong> — PostHog (ЕС), только с вашего согласия.</li>
                <li><strong>Мониторинг ошибок</strong> — Sentry (США), личные данные маскируются.</li>
                <li><strong>Наблюдаемость ИИ</strong> — Langfuse (логи ИИ-запросов для отладки: персона, действие, токены).</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">3. Шифрование</h2>
              <p>Ваши заметки шифруются на клиенте с использованием AES-256-GCM. Ключ шифрования выводится из вашего пароля через PBKDF2 (300 000 итераций). Зашифрованные данные хранятся в облаке — мы не имеем доступа к содержанию без вашего пароля.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">4. ИИ-функции</h2>
              <p>При использовании ИИ-чат, ИИ-редактирования или ИИ-саммаризации текст вашей заметки передаётся во внешний ИИ-API (OpenRouter). Мы не сохраняем содержимое запроса на наших серверах после генерации ответа. Метаданные запроса (персона, токены, модель) записываются для лимитирования и аналитики.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">5. Аналитика</h2>
              <p>Мы используем PostHog для анонимной продуктовой аналитики. Аналитика включается только с вашего согласия. Вы можете отключить аналитику в настройках в любой момент.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">6. Ваши права</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Доступ</strong> — вы можете экспортировать свои заметки (Настройки → Аккаунт → Экспорт).</li>
                <li><strong>Удаление</strong> — вы можете удалить отдельные заметки или сбросить достижения. Полное удаление аккаунта будет доступно после миграции.</li>
                <li><strong>Исправление</strong> — вы можете изменить никнейм в настройках профиля.</li>
                <li><strong>Отказ от аналитики</strong> — отключить в настройках в любой момент.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">7. Передача данных третьим лицам</h2>
              <p>Мы не продаём и не передаём ваши данные третьим лицам. Данные обрабатываются следующими сервисами:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>Google (Firebase Auth, Firestore)</li>
                <li>OpenRouter (ИИ-генерация)</li>
                <li>PostHog (аналитика, ЕС)</li>
                <li>Sentry (мониторинг ошибок)</li>
                <li>Langfuse (наблюдаемость ИИ)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">8. Хранение данных</h2>
              <p>Ваши заметки хранятся до тех пор, пока вы не удалите их. Метаданные ИИ-запросов хранятся для аналитики и лимитирования. Данные в аналитике и мониторинге ошибок хранятся в соответствии с политиками соответствующих сервисов.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">9. Дети</h2>
              <p>Приложение не предназначено для детей младше 16 лет. Если вам менее 16 лет, пожалуйста, не регистрируйтесь.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">10. Контакты</h2>
              <p>По вопросам конфиденциальности свяжитесь с нами через настройки приложения или по электронной почте.</p>
            </section>
          </>
        ) : (
          <>
            <section>
              <h2 className="text-base font-bold text-text-main mb-2">1. Data We Collect</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Email</strong> — for registration and authentication.</li>
                <li><strong>Written notes</strong> — your entries, titles, tags, mood.</li>
                <li><strong>Profile</strong> — nickname, stats (word count, streak, achievements).</li>
                <li><strong>AI metadata</strong> — request count, token usage, model.</li>
                <li><strong>Technical data</strong> — Web Vitals (CLS, FCP, INP, LCP, TTFB), error reports in Sentry.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">2. Where Data Is Stored</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Locally</strong> — in your browser&apos;s IndexedDB (local-first architecture).</li>
                <li><strong>In the cloud</strong> — Firebase Firestore (Google, US) when sync is enabled.</li>
                <li><strong>AI processing</strong> — text is sent to OpenRouter for response generation. Text is not stored on our servers after processing.</li>
                <li><strong>Analytics</strong> — PostHog (EU), only with your consent.</li>
                <li><strong>Error monitoring</strong> — Sentry (US), personal data is masked.</li>
                <li><strong>AI observability</strong> — Langfuse (AI request logs for debugging: persona, action, tokens).</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">3. Encryption</h2>
              <p>Your notes are encrypted client-side using AES-256-GCM. The encryption key is derived from your password via PBKDF2 (300,000 iterations). Encrypted data is stored in the cloud — we cannot access the content without your password.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">4. AI Features</h2>
              <p>When using AI chat, AI editing, or AI summarization, your note text is sent to an external AI API (OpenRouter). We do not store request content on our servers after generating a response. Request metadata (persona, tokens, model) is recorded for rate limiting and analytics.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">5. Analytics</h2>
              <p>We use PostHog for anonymous product analytics. Analytics are enabled only with your consent. You can disable analytics in settings at any time.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">6. Your Rights</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Access</strong> — you can export your notes (Settings → Account → Export).</li>
                <li><strong>Deletion</strong> — you can delete individual notes or reset achievements. Full account deletion will be available after migration.</li>
                <li><strong>Rectification</strong> — you can change your nickname in profile settings.</li>
                <li><strong>Opt-out of analytics</strong> — disable in settings at any time.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">7. Third-Party Data Sharing</h2>
              <p>We do not sell or share your data with third parties. Data is processed by the following services:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>Google (Firebase Auth, Firestore)</li>
                <li>OpenRouter (AI generation)</li>
                <li>PostHog (analytics, EU)</li>
                <li>Sentry (error monitoring)</li>
                <li>Langfuse (AI observability)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">8. Data Retention</h2>
              <p>Your notes are retained until you delete them. AI request metadata is retained for analytics and rate limiting. Analytics and error monitoring data is retained according to the respective service policies.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">9. Children</h2>
              <p>The app is not intended for children under 16. If you are under 16, please do not register.</p>
            </section>

            <section>
              <h2 className="text-base font-bold text-text-main mb-2">10. Contact</h2>
              <p>For privacy inquiries, contact us through the app settings or by email.</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
