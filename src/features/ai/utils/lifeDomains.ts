// Seeded life-domain facets. Each note is assigned to a domain when one of its
// chunk vectors is close enough (cosine) to the domain's seed embedding. This
// gives stable, human-named profile categories regardless of clustering noise.
// Specific people (отец/мать/жена/дети) are a separate Phase-2 entity feature.

export interface LifeDomain {
  id: string;
  label: string;
  /** Rich Russian seed text embedded to represent the domain. */
  seed: string;
}

export const LIFE_DOMAINS: LifeDomain[] = [
  {
    id: 'money',
    label: 'Деньги',
    seed: 'деньги, финансы, доходы и расходы, зарплата, долги, кредиты и рассрочки, накопления, крупные траты, финансовая стабильность и тревога из-за денег',
  },
  {
    id: 'children',
    label: 'Отношения с детьми',
    seed: 'дети, ребёнок, дочь, сын, родительство, воспитание, забота о детях, время и игры с детьми, тревога и радость за детей',
  },
  {
    id: 'partner',
    label: 'Отношения с партнёром по браку',
    seed: 'жена, муж, партнёр, супруга, супруг, брак, отношения в паре, любовь, близость, конфликты и обиды с партнёром, совместный быт',
  },
  {
    id: 'parents',
    label: 'Отношения с родителями',
    seed: 'мама, папа, мать, отец, родители, бабушка, дедушка, отношения с родителями, родительская семья, детские воспоминания о семье',
  },
  {
    id: 'colleagues',
    label: 'Отношения с коллегами',
    seed: 'коллеги, работа, начальник, руководитель, команда, клиенты, рабочие отношения, общение на работе, профессиональное взаимодействие',
  },
  {
    id: 'selfreal',
    label: 'Самореализация',
    seed: 'самореализация, цели, развитие, личностный рост, проекты, творчество, смысл, призвание, карьера, достижения, продуктивность, дисциплина и прокрастинация',
  },
];
