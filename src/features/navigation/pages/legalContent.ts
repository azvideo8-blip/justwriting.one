// Тексты правовых документов вынесены в данные, а не в разметку: три документа
// на двух языках, и в JSX они неизбежно разошлись бы между собой при первой же
// правке. Здесь русская и английская версии стоят рядом, и расхождение видно
// глазом.
//
// ЧЕРНОВИК. Документы подготовлены для юридической проверки. Всё, что требует
// реквизитов оператора, помечено квадратными скобками и заполняется после
// государственной регистрации — выдумывать эти сведения нельзя.
//
// Фактическая часть взята из docs/data-flows.md и docs/DPIA.md. При изменении
// поведения приложения правится и этот файл, в том же коммите: расхождение
// документа с делом здесь дороже, чем где-либо ещё.

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export interface LegalDocument {
  ru: { updated: string; sections: LegalSection[] };
  en: { updated: string; sections: LegalSection[] };
}

const UPDATED_RU = '18 августа 2026';
const UPDATED_EN = 'August 18, 2026';

export const PRIVACY_POLICY: LegalDocument = {
  ru: {
    updated: UPDATED_RU,
    sections: [
      {
        title: '1. Общие положения',
        paragraphs: [
          'Настоящая Политика определяет порядок обработки персональных данных в сервисе justwriting (justwriting.ru) — приложении для свободного письма и ведения личных записей.',
          'Оператор: [реквизиты указываются после государственной регистрации]. Ответственный за организацию обработки персональных данных: [Ф. И. О., контакт]. Адрес для обращений субъектов: [адрес электронной почты].',
          'Персональные данные — любая информация, относящаяся к прямо или косвенно определённому физическому лицу. Субъект — человек, к которому эти данные относятся. Обработка — любое действие с данными: сбор, хранение, использование, передача, удаление.',
          'Политика распространяется на все данные, которые Оператор получает от пользователей сервиса, и действует с момента публикации по этому адресу.',
        ],
      },
      {
        title: '2. Категории субъектов и состав данных',
        paragraphs: [
          'Субъекты — пользователи сервиса, физические лица, достигшие 16 лет.',
          'Учётные данные: адрес электронной почты, хэш пароля, отображаемое имя, дата создания учётной записи, роль, отметки о принятых согласиях и их версия.',
          'Содержимое, создаваемое пользователем: тексты записей и все сохранённые версии, заголовки, теги, отметка настроения, даты и продолжительность сессий письма.',
          'Данные, производные от содержимого и создаваемые по запросу пользователя: краткие изложения записей, темы, векторные представления текста для поиска по смыслу, психологический портрет и грани профиля, история диалогов и память чата.',
          'Технические данные: адрес IP и сведения о запросах в журналах веб-сервера, учёт количества обращений к функциям ИИ для соблюдения суточных ограничений.',
          'Специальные категории. Личные записи по своей природе могут содержать сведения о состоянии здоровья, психоэмоциональном состоянии и интимной жизни. Такие сведения относятся к специальным категориям персональных данных и обрабатываются исключительно на основании отдельного согласия, которое запрашивается отдельно от согласия с настоящей Политикой и может быть отозвано.',
          'Данные третьих лиц. Пользователь может упомянуть в записи других людей. Оператор не ведёт реестра упомянутых лиц, не строит их профилей и не извлекает сведения о них автоматически. Ответственность за упоминание третьих лиц несёт пользователь.',
        ],
      },
      {
        title: '3. Цели обработки',
        paragraphs: [
          'Предоставление доступа к сервису и идентификация пользователя — учётные данные.',
          'Хранение записей и их синхронизация между устройствами пользователя — содержимое, создаваемое пользователем.',
          'Выполнение функций искусственного интеллекта по запросу пользователя: разбор отдельной записи, ответ в диалоге, поиск по смыслу, пересчёт профиля — содержимое и производные данные.',
          'Обеспечение работоспособности и безопасности сервиса, расследование сбоев, соблюдение ограничений на количество запросов — технические данные.',
          'Направление служебных сообщений: подтверждение адреса, восстановление пароля, уведомление об изменении условий — адрес электронной почты. Рекламные рассылки не ведутся.',
          'Иных целей нет. Данные не используются для рекламы, профилирования в интересах третьих лиц, оценки платёжеспособности и принятия юридически значимых решений.',
        ],
      },
      {
        title: '4. Правовые основания',
        paragraphs: [
          'Согласие субъекта — для обработки содержимого записей и производных от него данных.',
          'Отдельное согласие на обработку специальных категорий персональных данных — для сведений, названных в разделе 2.',
          'Договор (оферта), стороной которого является субъект, — для предоставления доступа к сервису.',
          'Законные интересы Оператора в объёме, не нарушающем прав субъекта, — для обеспечения безопасности и работоспособности сервиса.',
        ],
      },
      {
        title: '5. Порядок и условия обработки',
        paragraphs: [
          'Обработка ведётся смешанным способом: с использованием средств автоматизации и без них.',
          'Записи и учётные данные хранятся в базе данных на сервере на территории Российской Федерации (Москва). Сбор персональных данных граждан Российской Федерации осуществляется с использованием баз данных, находящихся на территории Российской Федерации.',
          'Содержимое записей, их заголовки, теги, метки, отметка настроения, а также производные данные — разборы записей, поисковые векторы, история диалогов и психологический портрет — передаются и хранятся в облачной копии в зашифрованном виде. Ключ шифрования вычисляется из пароля пользователя на его устройстве и Оператору не передаётся; технической возможности прочитать эти сведения у Оператора нет. В открытом виде хранятся только даты и продолжительность сессий письма, счётчики слов и служебные идентификаторы — они необходимы для упорядочивания записей и подсчёта статистики на стороне сервера.',
          'Автоматической обработки содержимого не производится. Текст записи передаётся поставщику услуг искусственного интеллекта только по явному действию пользователя: при нажатии кнопки разбора у конкретной записи либо при отправке вопроса в диалоге.',
          'Поставщик услуг искусственного интеллекта — RouterAI. По сведениям поставщика, содержимое запросов и ответов им не сохраняется и не используется для обучения моделей; сохраняются сведения, необходимые для расчёта стоимости. Вычисление ответа выполняет провайдер нейросетевой модели, который по умолчанию может находиться за пределами Российской Федерации, в том числе в государствах, не обеспечивающих адекватной защиты прав субъектов персональных данных. Такая передача является трансграничной. Оператор раскрывает это обстоятельство прямо и работает над его устранением.',
          'Отправка служебных писем выполняется через почтового провайдера, серверы которого расположены на территории Российской Федерации.',
          'Иным лицам персональные данные не передаются, за исключением случаев, предусмотренных законодательством Российской Федерации.',
          'Меры защиты: доступ к серверу только по ключу, шифрование канала связи, разграничение доступа к данным на уровне базы данных, ограничение частоты обращений, регулярное резервное копирование, ведение журналов.',
        ],
      },
      {
        title: '6. Сроки хранения',
        paragraphs: [
          'Данные обрабатываются до достижения целей обработки, отзыва согласия либо удаления учётной записи.',
          'Удаление учётной записи влечёт удаление записей, их версий, производных данных и учётных сведений.',
          'Резервные копии базы данных хранятся ограниченное время. В течение этого срока удалённые данные могут сохраняться в копиях и уничтожаются вместе с истечением срока хранения копии.',
          'Технические журналы хранятся ограниченное время и затем уничтожаются.',
        ],
      },
      {
        title: '7. Права субъекта персональных данных',
        paragraphs: [
          'Субъект вправе получать сведения об обработке своих данных; требовать их уточнения, блокирования или уничтожения, если они неполны, устарели, неточны, получены незаконно или не являются необходимыми для заявленной цели; отозвать согласие; обжаловать действия Оператора в Роскомнадзоре или в суде.',
          'Отзыв согласия на обработку специальных категорий не лишает доступа к сервису: письмо без функций искусственного интеллекта остаётся доступным.',
          'Запрос направляется на адрес для обращений, указанный в разделе 1. Ответ даётся в течение 10 рабочих дней со дня получения запроса; срок может быть продлён не более чем на 5 рабочих дней с уведомлением заявителя.',
          'Удалить учётную запись со всеми данными можно самостоятельно в настройках сервиса.',
        ],
      },
      {
        title: '8. Изменение Политики',
        paragraphs: [
          'Оператор вправе изменять Политику; действующая редакция размещается по этому адресу.',
          'При изменении, затрагивающем состав данных, цели или условия обработки, у пользователя запрашивается согласие с новой редакцией. До получения согласия обработка по новому основанию не ведётся.',
        ],
      },
    ],
  },
  en: {
    updated: UPDATED_EN,
    sections: [
      {
        title: '1. General',
        paragraphs: [
          'This Policy sets out how personal data is processed in justwriting (justwriting.ru), an application for free writing and keeping personal notes.',
          'Operator: [details to be filled in after state registration]. Person responsible for organising the processing of personal data: [name, contact]. Address for data subject requests: [email address].',
          'Personal data means any information relating to a directly or indirectly identified individual. The subject is the person the data relates to. Processing means any operation on the data: collection, storage, use, transfer, deletion.',
          'The Policy covers all data the Operator receives from users of the service and applies from the moment it is published at this address.',
        ],
      },
      {
        title: '2. Categories of subjects and data',
        paragraphs: [
          'Subjects are users of the service, individuals aged 16 and over.',
          'Account data: email address, password hash, display name, account creation date, role, records of accepted consents and their version.',
          'User-created content: note texts and all saved versions, titles, tags, mood marker, dates and durations of writing sessions.',
          'Data derived from content and created at the user’s request: note summaries, themes, vector representations of text for meaning-based search, a psychological portrait and profile facets, dialogue history and chat memory.',
          'Technical data: IP address and request details in web server logs, counts of AI requests for enforcing daily limits.',
          'Special categories. Personal notes may by their nature contain information about health, emotional state and intimate life. Such information belongs to special categories of personal data and is processed solely on the basis of a separate consent, requested apart from agreement with this Policy and revocable at any time.',
          'Third-party data. A user may mention other people in a note. The Operator keeps no registry of mentioned persons, builds no profiles of them and extracts no information about them automatically. Responsibility for mentioning third parties rests with the user.',
        ],
      },
      {
        title: '3. Purposes of processing',
        paragraphs: [
          'Providing access to the service and identifying the user — account data.',
          'Storing notes and synchronising them between the user’s devices — user-created content.',
          'Performing AI functions at the user’s request: analysing a single note, answering in dialogue, meaning-based search, recomputing the profile — content and derived data.',
          'Keeping the service working and secure, investigating failures, enforcing request limits — technical data.',
          'Sending service messages: address confirmation, password recovery, notice of changed terms — email address. No marketing mailings are sent.',
          'There are no other purposes. Data is not used for advertising, profiling in the interests of third parties, creditworthiness assessment or legally significant decisions.',
        ],
      },
      {
        title: '4. Legal grounds',
        paragraphs: [
          'Consent of the subject — for processing note content and data derived from it.',
          'Separate consent to the processing of special categories of personal data — for the information named in section 2.',
          'A contract (offer) to which the subject is a party — for providing access to the service.',
          'The Operator’s legitimate interests, to the extent that they do not infringe the subject’s rights — for security and availability of the service.',
        ],
      },
      {
        title: '5. How processing is carried out',
        paragraphs: [
          'Processing is carried out both with and without automation.',
          'Notes and account data are stored in a database on a server located in the Russian Federation (Moscow). Personal data of citizens of the Russian Federation is collected using databases located in the Russian Federation.',
          'Note contents, their titles, tags, labels, the mood marker, and derived data — note analyses, search vectors, dialogue history and the psychological portrait — are transmitted and stored in the cloud copy in encrypted form. The encryption key is derived from the user’s password on their own device and is never sent to the Operator; the Operator has no technical means to read any of it. Stored in the clear are only the dates and durations of writing sessions, word counts and service identifiers — these are needed to order notes and compute statistics on the server side.',
          'No automatic processing of content takes place. A note’s text is sent to the AI provider only on an explicit action by the user: pressing the analyse button on a particular note, or sending a question in dialogue.',
          'The AI provider is RouterAI. According to the provider, request and response contents are not stored and are not used to train models; what is kept is the information needed for billing. The answer itself is computed by the model provider, which by default may be located outside the Russian Federation, including in states that do not provide adequate protection of data subjects’ rights. Such transfer is cross-border. The Operator discloses this plainly and is working to remove it.',
          'Service emails are sent through a mail provider whose servers are located in the Russian Federation.',
          'Personal data is not passed to anyone else, except in cases provided for by the legislation of the Russian Federation.',
          'Protective measures: key-only server access, encrypted transport, row-level access separation in the database, request rate limits, regular backups, access logging.',
        ],
      },
      {
        title: '6. Retention periods',
        paragraphs: [
          'Data is processed until the purposes are achieved, consent is withdrawn, or the account is deleted.',
          'Deleting an account removes the notes, their versions, derived data and account information.',
          'Database backups are kept for a limited time. During that period deleted data may persist in the copies and is destroyed when the copy’s retention period expires.',
          'Technical logs are kept for a limited time and then destroyed.',
        ],
      },
      {
        title: '7. Rights of the data subject',
        paragraphs: [
          'The subject may obtain information about the processing of their data; require it to be corrected, blocked or destroyed if it is incomplete, outdated, inaccurate, unlawfully obtained or unnecessary for the stated purpose; withdraw consent; and appeal the Operator’s actions to Roskomnadzor or in court.',
          'Withdrawing consent to the processing of special categories does not remove access to the service: writing without AI features remains available.',
          'Requests are sent to the address given in section 1. An answer is given within 10 working days of receipt; the period may be extended by no more than 5 working days with notice to the applicant.',
          'An account and all its data can be deleted by the user in the service settings.',
        ],
      },
      {
        title: '8. Changes to this Policy',
        paragraphs: [
          'The Operator may change this Policy; the current revision is published at this address.',
          'Where a change affects the data collected, the purposes or the conditions of processing, the user is asked to agree to the new revision. Until that consent is given, processing on the new basis does not take place.',
        ],
      },
    ],
  },
};

// Согласие на обработку персональных данных, включая специальные категории.
//
// Состав реквизитов — по ч. 4 ст. 9 152-ФЗ. Отдельность этого согласия
// принципиальна: спрятанное в общую галочку «согласен с политикой», оно не
// считается данным для специальных категорий, а тексты дневника таковыми
// являются по своей природе.
export const CONSENT: LegalDocument = {
  ru: {
    updated: UPDATED_RU,
    sections: [
      {
        title: 'Кому и от кого',
        paragraphs: [
          'Согласие даётся Оператору сервиса justwriting (justwriting.ru): [реквизиты указываются после государственной регистрации].',
          'Субъект персональных данных идентифицируется по адресу электронной почты, указанному при регистрации. Иных сведений о личности сервис не запрашивает.',
        ],
      },
      {
        title: 'На обработку каких данных',
        paragraphs: [
          'Адрес электронной почты, хэш пароля, отображаемое имя, сведения об учётной записи.',
          'Тексты записей и все их версии, заголовки, теги, отметка настроения, даты и продолжительность сессий письма.',
          'Данные, вычисляемые по запросу пользователя на основе записей: краткие изложения, темы, векторные представления текста, психологический портрет, грани профиля, история диалогов с ИИ.',
        ],
      },
      {
        title: 'Отдельно — на специальные категории',
        paragraphs: [
          'Личные записи по своей природе могут содержать сведения о состоянии здоровья, психоэмоциональном состоянии и интимной жизни. Это специальные категории персональных данных (ст. 10 152-ФЗ).',
          'Согласие на их обработку даётся отдельно от согласия с Политикой и не является условием доступа к сервису: при отказе остаётся доступным письмо и хранение записей без функций искусственного интеллекта.',
        ],
      },
      {
        title: 'С какой целью',
        paragraphs: [
          'Предоставление доступа к сервису, хранение и синхронизация записей между устройствами пользователя.',
          'Выполнение по запросу пользователя функций искусственного интеллекта: разбор записи, ответ в диалоге, поиск по смыслу, построение и пересчёт психологического портрета и граней профиля.',
        ],
      },
      {
        title: 'Какие действия разрешаются',
        paragraphs: [
          'Сбор, запись, систематизация, накопление, хранение, уточнение, извлечение, использование, передача поставщику услуг искусственного интеллекта в объёме, необходимом для выполнения запроса, блокирование, удаление и уничтожение.',
          'Обработка ведётся смешанным способом: с использованием средств автоматизации и без них.',
          'Передача содержимого записей поставщику услуг искусственного интеллекта производится только по явному действию пользователя. Вычисление ответа может выполняться провайдером модели за пределами Российской Федерации; это трансграничная передача, и согласие даётся в том числе на неё.',
        ],
      },
      {
        title: 'Срок и отзыв',
        paragraphs: [
          'Согласие действует со дня его предоставления до достижения целей обработки, отзыва согласия или удаления учётной записи.',
          'Отзыв производится сообщением на адрес для обращений, указанный в Политике, либо удалением учётной записи в настройках сервиса. Отзыв согласия на специальные категории не влечёт прекращения доступа к сервису.',
          'При изменении текста согласия по существу согласие запрашивается заново; ранее данное согласие новую редакцию не покрывает.',
        ],
      },
    ],
  },
  en: {
    updated: UPDATED_EN,
    sections: [
      {
        title: 'To whom and by whom',
        paragraphs: [
          'Consent is given to the Operator of justwriting (justwriting.ru): [details to be filled in after state registration].',
          'The data subject is identified by the email address given at registration. The service asks for no other identifying information.',
        ],
      },
      {
        title: 'Which data',
        paragraphs: [
          'Email address, password hash, display name, account information.',
          'Note texts and all their versions, titles, tags, mood marker, dates and durations of writing sessions.',
          'Data computed from notes at the user’s request: summaries, themes, vector representations, a psychological portrait, profile facets, dialogue history.',
        ],
      },
      {
        title: 'Separately — special categories',
        paragraphs: [
          'Personal notes may by their nature contain information about health, emotional state and intimate life. These are special categories of personal data (art. 10 of Federal Law 152-FZ).',
          'Consent to their processing is given separately from agreement with the Policy and is not a condition of access: if it is declined, writing and storing notes without AI features remain available.',
        ],
      },
      {
        title: 'For what purpose',
        paragraphs: [
          'Providing access to the service, storing notes and synchronising them between the user’s devices.',
          'Performing, at the user’s request, AI functions: analysing a note, answering in dialogue, meaning-based search, building and recomputing a psychological portrait and profile facets.',
        ],
      },
      {
        title: 'Which operations are permitted',
        paragraphs: [
          'Collection, recording, organisation, accumulation, storage, correction, retrieval, use, transfer to the AI provider to the extent needed to fulfil a request, blocking, deletion and destruction.',
          'Processing is carried out both with and without automation.',
          'Note contents are passed to the AI provider only on an explicit action by the user. The answer may be computed by a model provider outside the Russian Federation; this is a cross-border transfer, and consent covers it as well.',
        ],
      },
      {
        title: 'Duration and withdrawal',
        paragraphs: [
          'Consent is effective from the day it is given until the purposes are achieved, it is withdrawn, or the account is deleted.',
          'Withdrawal is done by writing to the address given in the Policy, or by deleting the account in the service settings. Withdrawing consent for special categories does not end access to the service.',
          'If the text of the consent changes in substance, consent is requested again; consent given earlier does not cover the new revision.',
        ],
      },
    ],
  },
};

// Условия использования (оферта). Прежняя редакция описывала сервис в
// продуктовом регистре и молчала о том, что важно юридически: что это не
// медицинская помощь, кто отвечает за упоминание третьих лиц и что происходит
// с доступом при утрате пароля шифрования.
export const TERMS: LegalDocument = {
  ru: {
    updated: UPDATED_RU,
    sections: [
      {
        title: 'Четыре обещания',
        paragraphs: [
          'Написанное не пропадает. Всё, что вы написали на устройстве, остаётся вашим и сохраняется — кроме случая, когда вы сами решаете это удалить. Есть две границы, о которых честнее сказать сразу: если вы потеряли пароль шифрования вместе с кодом восстановления, содержимое не откроет никто, включая Оператора; и если облачная копия выключена вами, то утрата устройства означает утрату записей — восстанавливать будет неоткуда.',
          'В облако уходит только зашифрованное. Записи, заголовки, теги, метки, разборы, диалоги, портрет — всё, что вы написали или что написано о вас, покидает устройство только в зашифрованном виде. Ключ вычисляется на вашем устройстве и Оператору не передаётся.',
          'Искусственный интеллект — исключение, и вы решаете сами. Чтобы разобрать запись или ответить на вопрос, её текст приходится передать поставщику услуг искусственного интеллекта в открытом виде: иначе разбор невозможен. Это единственный случай, когда написанное вами покидает зашифрованный контур. Пользоваться этими функциями или нет — ваш выбор, и отказ от них не ограничивает работу с записями.',
          'Всё сохранено, зашифровано, синхронизировано, и наружу не ушло ничего, кроме отправленного вами в разбор. Это и есть задача, которую Оператор перед собой ставит и по которой просит себя судить.',
        ],
      },
      {
        title: '1. О чём договор',
        paragraphs: [
          'Настоящие Условия регулируют использование сервиса justwriting (justwriting.ru) — приложения для свободного письма и ведения личных записей.',
          'Оператор: [реквизиты указываются после государственной регистрации].',
          'Использование сервиса означает согласие с настоящими Условиями. Если вы с ними не согласны, пользоваться сервисом нельзя.',
        ],
      },
      {
        title: '2. Что сервис делает',
        paragraphs: [
          'Сервис позволяет вести личные записи, хранить их на устройстве и, по выбору пользователя, в облачной копии, а также обращаться к функциям искусственного интеллекта: разбору отдельной записи, диалогу, поиску по смыслу, построению психологического портрета.',
          'Сервис доступен по мере возможности. Оператор не гарантирует непрерывной работы и вправе приостанавливать её для обслуживания.',
        ],
      },
      {
        title: '3. Это не медицинская и не психологическая помощь',
        paragraphs: [
          'Сервис не является медицинским изделием, не ставит диагнозов и не назначает лечения. Ответы искусственного интеллекта носят вспомогательный характер и не заменяют консультацию врача или психотерапевта.',
          'Если вы переживаете кризис или думаете о причинении вреда себе, обратитесь за профессиональной помощью или в службу экстренной психологической поддержки.',
        ],
      },
      {
        title: '4. Ваши записи',
        paragraphs: [
          'Права на созданные вами тексты остаются за вами. Оператор не претендует на них и не использует их для обучения моделей.',
          'Содержимое записей хранится в облачной копии в зашифрованном виде. Ключ вычисляется из вашего пароля шифрования и Оператору не передаётся.',
          'Утрата пароля шифрования означает безвозвратную потерю доступа к зашифрованному содержимому: восстановить его невозможно ни вам, ни Оператору. Пароль входа и пароль шифрования — разные вещи, и смена первого не открывает записи.',
        ],
      },
      {
        title: '5. Упоминание других людей',
        paragraphs: [
          'Записи могут содержать сведения о других людях. Эти люди согласия не давали, и вы не вправе дать его за них.',
          'Ответственность за упоминание третьих лиц и за последствия такого упоминания несёт пользователь. Оператор не ведёт реестра упомянутых лиц и не строит их профилей.',
        ],
      },
      {
        title: '6. Допустимое использование',
        paragraphs: [
          'Запрещается использовать сервис для действий, нарушающих законодательство Российской Федерации, для получения материалов, призывающих к насилию или иным противоправным действиям, а также для попыток обойти технические ограничения, помешать работе сервиса или получить доступ к чужим данным.',
          'Количество обращений к функциям искусственного интеллекта ограничено; ограничения могут меняться.',
        ],
      },
      {
        title: '7. Ответственность',
        paragraphs: [
          'Сервис предоставляется «как есть». Оператор не отвечает за решения, принятые пользователем на основании ответов искусственного интеллекта, и за точность этих ответов.',
          'Оператор принимает разумные меры для сохранности данных, включая регулярное резервное копирование, но не гарантирует их сохранности при обстоятельствах, находящихся вне его контроля. Пользователю рекомендуется хранить собственную копию: в настройках есть выгрузка всех данных одним файлом.',
        ],
      },
      {
        title: '8. Возраст',
        paragraphs: [
          'Сервис предназначен для лиц, достигших 16 лет. Регистрируясь, вы подтверждаете, что вам исполнилось 16 лет.',
        ],
      },
      {
        title: '9. Прекращение и изменения',
        paragraphs: [
          'Вы можете в любой момент удалить учётную запись в настройках; это влечёт удаление записей и производных данных.',
          'Оператор вправе изменять настоящие Условия. Действующая редакция размещается по этому адресу; при существенных изменениях пользователь уведомляется, а согласие запрашивается заново.',
        ],
      },
    ],
  },
  en: {
    updated: UPDATED_EN,
    sections: [
      {
        title: 'Four promises',
        paragraphs: [
          'What you write does not disappear. Everything you have written on your device stays yours and is kept — except when you yourself decide to delete it. Two boundaries are worth stating plainly: if you lose your encryption password together with your recovery code, no one can open the contents, the Operator included; and if you have turned the cloud copy off, losing the device means losing the notes, because there is nowhere to restore them from.',
          'Only encrypted data goes to the cloud. Notes, titles, tags, labels, analyses, dialogues, the portrait — everything you wrote or that was written about you leaves the device in encrypted form only. The key is derived on your device and is never sent to the Operator.',
          'Artificial intelligence is the exception, and the choice is yours. To analyse a note or answer a question, its text must be sent to the AI provider in the clear: there is no other way to do it. This is the only case where what you wrote leaves the encrypted perimeter. Whether to use these features is your decision, and declining them does not limit your work with notes.',
          'Everything saved, encrypted, synchronised, and nothing leaked except what you sent for analysis. That is the task the Operator sets itself and asks to be judged by.',
        ],
      },
      {
        title: '1. What this covers',
        paragraphs: [
          'These Terms govern the use of justwriting (justwriting.ru), an application for free writing and keeping personal notes.',
          'Operator: [details to be filled in after state registration].',
          'Using the service means agreeing to these Terms. If you do not agree with them, you may not use the service.',
        ],
      },
      {
        title: '2. What the service does',
        paragraphs: [
          'The service lets you keep personal notes, store them on your device and, at your choice, in a cloud copy, and use AI features: analysing a single note, dialogue, meaning-based search, building a psychological portrait.',
          'The service is provided on a best-effort basis. The Operator does not guarantee uninterrupted operation and may suspend it for maintenance.',
        ],
      },
      {
        title: '3. This is not medical or psychological care',
        paragraphs: [
          'The service is not a medical device, makes no diagnoses and prescribes no treatment. AI answers are supportive in nature and do not replace consultation with a doctor or psychotherapist.',
          'If you are in crisis or thinking of harming yourself, seek professional help or an emergency psychological support service.',
        ],
      },
      {
        title: '4. Your notes',
        paragraphs: [
          'Rights to the texts you create remain yours. The Operator makes no claim to them and does not use them to train models.',
          'Note contents are stored in the cloud copy in encrypted form. The key is derived from your encryption password and is never sent to the Operator.',
          'Losing the encryption password means irreversible loss of access to the encrypted contents: neither you nor the Operator can recover them. The sign-in password and the encryption password are different things, and changing the first does not unlock the notes.',
        ],
      },
      {
        title: '5. Mentioning other people',
        paragraphs: [
          'Notes may contain information about other people. Those people gave no consent, and you cannot give it on their behalf.',
          'Responsibility for mentioning third parties and for the consequences of doing so rests with the user. The Operator keeps no registry of mentioned persons and builds no profiles of them.',
        ],
      },
      {
        title: '6. Acceptable use',
        paragraphs: [
          'You may not use the service for anything that breaks the law of the Russian Federation, to obtain material calling for violence or other unlawful acts, or to attempt to bypass technical limits, disrupt the service or reach other people’s data.',
          'The number of AI requests is limited; the limits may change.',
        ],
      },
      {
        title: '7. Liability',
        paragraphs: [
          'The service is provided "as is". The Operator is not responsible for decisions the user makes on the basis of AI answers, nor for the accuracy of those answers.',
          'The Operator takes reasonable measures to preserve data, including regular backups, but does not guarantee preservation in circumstances beyond its control. Users are advised to keep their own copy: settings offer a full export in one file.',
        ],
      },
      {
        title: '8. Age',
        paragraphs: [
          'The service is intended for people aged 16 and over. By registering you confirm that you are at least 16 years old.',
        ],
      },
      {
        title: '9. Termination and changes',
        paragraphs: [
          'You may delete your account at any time in the settings; this removes your notes and derived data.',
          'The Operator may change these Terms. The current revision is published at this address; for material changes users are notified and consent is requested again.',
        ],
      },
    ],
  },
};
