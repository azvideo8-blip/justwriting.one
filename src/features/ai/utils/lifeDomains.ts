// Seeded life-domain facets. Each note is assigned to a domain when one of its
// chunk vectors is close enough (cosine) to the domain's seed embedding. This
// gives stable, human-named profile categories regardless of clustering noise.
// Specific people (отец/мать/жена/дети) are a separate Phase-2 entity feature.

export interface LifeDomain {
  id: string;
  label: string;
  /** Rich Russian seed text embedded to represent the domain. */
  seed: string;
  /** Override the global DOMAIN_THRESHOLD for this domain. Higher = stricter. */
  threshold?: number;
}

// Thresholds tuned on real corpus (2026-06-28): relationship domains were
// over-binding at 0.38–0.42 (partner swallowed 56/90 notes) while the strict
// 0.55 selfreal stayed high-precision. Lesson: keep introspective/dominant
// domains strict (~0.49–0.50). "Коллеги" replaced by "Практика психолога"
// (the user's work is therapy practice, not generic coworkers); added
// Творчество/проекты and Внутренняя работа for the corpus's dominant themes.
export const LIFE_DOMAINS: LifeDomain[] = [
  {
    id: 'money',
    label: 'Деньги',
    seed: 'деньги, финансы, доходы и расходы, зарплата и цена за сессию, долги, кредиты и рассрочки, накопления, крупные траты, финансовая стабильность и тревога из-за денег',
    threshold: 0.45,
  },
  {
    id: 'children',
    label: 'Отношения с детьми',
    seed: 'дети, ребёнок, дочь, сын, родительство, воспитание, забота о детях, время и игры с детьми, тревога и радость за детей',
    threshold: 0.42,
  },
  {
    id: 'partner',
    label: 'Отношения с партнёром по браку',
    seed: 'жена, муж, партнёр, супруга, супруг, брак, отношения в паре, любовь, близость, конфликты и обиды с партнёром, совместный быт',
    threshold: 0.45,
  },
  {
    id: 'parents',
    label: 'Отношения с родителями',
    seed: 'мама, папа, мать, отец, родители, бабушка, дедушка, отношения с родителями, родительская семья, детские воспоминания о семье',
    threshold: 0.45,
  },
  {
    id: 'selfreal',
    label: 'Призвание и смысл',
    seed: 'призвание и смысл жизни, поиск своего пути и предназначения, зачем я живу и кем быть, чем заниматься дальше, самореализация, значимость и нужность своего труда, желание оставить след, кризис смысла и поиск направления',
    threshold: 0.49,
  },
  {
    id: 'practice',
    label: 'Практика психолога',
    seed: 'моя работа психологом и психотерапевтом, клиенты и клиентки, сессии и приём, супервизия и интервизия, ведение частной практики, профессиональное выгорание и нагрузка, отношения с клиентами',
    threshold: 0.49,
  },
  {
    // Strict (0.54) + narrow seed: the journal is written IN this app ABOUT
    // building it, so app/writing is ambient background in nearly every entry.
    // A broad seed (v1) made this the new over-binder (65/90). Keep it to the
    // concrete PRODUCT/engineering work; ambient "поработал над приложением"
    // mentions fall through to their real topic or Призвание.
    id: 'creativity',
    label: 'Творчество и проекты',
    seed: 'разработка и проектирование моего приложения justwriting, программирование, новые функции, архитектура и баги, дизайн интерфейса, запуск и продвижение продукта, идеи новых проектов и фич',
    threshold: 0.54,
  },
  {
    id: 'inner_work',
    label: 'Внутренняя работа',
    seed: 'внутренняя работа над собой, психотерапия и осознания, личные границы, разрешение себе желаний, детские травмы и раны, стыд и вина, отделение себя от других, эмоции и саморефлексия',
    threshold: 0.46,
  },
];
