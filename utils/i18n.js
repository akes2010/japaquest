'use strict';
/**
 * i18n — multi-language targeting for travellers.
 *
 * The visitor's languages come from geo detection (country → likely languages)
 * and the Accept-Language header; the traveller can override with a saved
 * preference. Only UI chrome is translated here — AI-generated travel content
 * stays in English (the AI persona handles language when asked).
 *
 * Adding a language: append to STRINGS for every key. Missing keys fall back
 * to English automatically, so partial translations are safe.
 */
const STRINGS = {
  en: {
    tag_hero_kicker: 'For African passports',
    tag_hero_title: 'Visas, letters & budgets — sorted before you fly.',
    tag_hero_cta: 'Plan my trip — free',
    tag_nav_suite: 'The Suite',
    tag_budget_total: 'Total',
    tag_accommodation: 'Accommodation',
    tag_food: 'Food & Drinks',
    tag_transport: 'Local Transport',
    tag_activities: 'Activities',
    tag_misc: 'Misc',
    tag_concierge: 'Human Help',
    tag_readiness: 'Readiness',
    tag_notifications: 'Notifications',
    tag_search_ph: 'Ask anything — visas, budgets, documents…',
    tag_chat_greeting: 'Hi! I am your JapaQuest AI travel agent. Where to next?',
  },
  fr: {
    tag_hero_kicker: 'Pour les passeports africains',
    tag_hero_title: 'Visas, lettres & budgets — réglés avant de partir.',
    tag_hero_cta: 'Planifier mon voyage — gratuit',
    tag_nav_suite: 'La Suite',
    tag_budget_total: 'Total',
    tag_accommodation: 'Hébergement',
    tag_food: 'Restauration',
    tag_transport: 'Transport local',
    tag_activities: 'Activités',
    tag_misc: 'Divers',
    tag_concierge: 'Aide humaine',
    tag_readiness: 'Préparation',
    tag_notifications: 'Notifications',
    tag_search_ph: 'Posez votre question — visas, budgets, documents…',
    tag_chat_greeting: 'Bonjour ! Je suis votre agent de voyage IA JapaQuest. On part où ?',
  },
  es: {
    tag_hero_kicker: 'Para pasaportes africanos',
    tag_hero_title: 'Visas, cartas y presupuestos — listos antes de volar.',
    tag_hero_cta: 'Planear mi viaje — gratis',
    tag_nav_suite: 'La Suite',
    tag_budget_total: 'Total',
    tag_accommodation: 'Alojamiento',
    tag_food: 'Comida y bebidas',
    tag_transport: 'Transporte local',
    tag_activities: 'Actividades',
    tag_misc: 'Varios',
    tag_concierge: 'Ayuda humana',
    tag_readiness: 'Preparación',
    tag_notifications: 'Notificaciones',
    tag_search_ph: 'Pregunta lo que quieras — visados, presupuestos, documentos…',
    tag_chat_greeting: '¡Hola! Soy tu agente de viajes IA de JapaQuest. ¿A dónde vamos?',
  },
  pt: {
    tag_hero_kicker: 'Para passaportes africanos',
    tag_hero_title: 'Vistos, cartas e orçamentos — prontos antes de voar.',
    tag_hero_cta: 'Planear a minha viagem — grátis',
    tag_nav_suite: 'A Suite',
    tag_budget_total: 'Total',
    tag_accommodation: 'Alojamento',
    tag_food: 'Comida e bebidas',
    tag_transport: 'Transporte local',
    tag_activities: 'Atividades',
    tag_misc: 'Diversos',
    tag_concierge: 'Ajuda humana',
    tag_readiness: 'Preparação',
    tag_notifications: 'Notificações',
    tag_search_ph: 'Pergunte o que quiser — vistos, orçamentos, documentos…',
    tag_chat_greeting: 'Olá! Sou o seu agente de viagens IA do JapaQuest. Para onde vamos?',
  },
  ar: {
    tag_hero_kicker: 'لجوازات أفريقيا',
    tag_hero_title: 'التأشيرات والرسائل والميزانيات — جاهزة قبل السفر.',
    tag_hero_cta: 'خطط رحلتي — مجاناً',
    tag_nav_suite: 'المجموعة',
    tag_budget_total: 'الإجمالي',
    tag_accommodation: 'الإقامة',
    tag_food: 'الطعام والشراب',
    tag_transport: 'المواصلات المحلية',
    tag_activities: 'الأنشطة',
    tag_misc: 'متفرقات',
    tag_concierge: 'مساعدة بشرية',
    tag_readiness: 'الجاهزية',
    tag_notifications: 'الإشعارات',
    tag_search_ph: 'اسأل أي شيء — تأشيرات، ميزانيات، مستندات…',
    tag_chat_greeting: 'مرحباً! أنا وكيل السفر الذكي من JapaQuest. إلى أين نذهب؟',
  },
  sw: {
    tag_hero_kicker: 'Kwa pasipoti za Afrika',
    tag_hero_title: 'Viza, barua na bajeti — tayari kabla ya kusafiri.',
    tag_hero_cta: 'Panga safari yangu — bure',
    tag_nav_suite: 'Seti',
    tag_budget_total: 'Jumla',
    tag_accommodation: 'Malazi',
    tag_food: 'Chakula na vinywaji',
    tag_transport: 'Usafiri wa mitaa',
    tag_activities: 'Shughuli',
    tag_misc: 'Mengineyo',
    tag_concierge: 'Msaada wa binadamu',
    tag_readiness: 'Utayari',
    tag_notifications: 'Arifa',
    tag_search_ph: 'Uliza chochote — viza, bajeti, hati…',
    tag_chat_greeting: 'Habari! Mimi ni wakala wako wa usafiri wa JapaQuest. Twaendea wapi?',
  },
};

// Languages the platform serves (superset of STRINGS keys shown in the picker).
const LANGUAGES = [
  { code: 'en', name: 'English',  flag: '🇬🇧', rtl: false },
  { code: 'fr', name: 'Français', flag: '🇫🇷', rtl: false },
  { code: 'es', name: 'Español',  flag: '🇪🇸', rtl: false },
  { code: 'pt', name: 'Português', flag: '🇵🇹', rtl: false },
  { code: 'ar', name: 'العربية',  flag: '🇸🇦', rtl: true },
  { code: 'sw', name: 'Kiswahili', flag: '🇰🇪', rtl: false },
];

const RTL = new Set(['ar', 'he', 'fa', 'ur']);

function isSupported(code) { return !!STRINGS[code]; }

// Parse an Accept-Language header into ordered language codes.
function parseAcceptLanguage(header) {
  return String(header || '')
    .split(',')
    .map(part => {
      const [tag, q] = part.trim().split(';q=');
      return { tag: tag.trim().toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .filter(p => p.tag)
    .sort((a, b) => b.q - a.q)
    .map(p => p.tag.split('-')[0]);
}

// Negotiate the best locale: explicit pref → Accept-Language → geo langs → en.
function negotiate({ pref, acceptLanguage, geoLanguages }) {
  if (pref && isSupported(pref)) return pref;
  const candidates = [
    ...parseAcceptLanguage(acceptLanguage),
    ...(geoLanguages || []),
  ];
  for (const c of candidates) if (isSupported(c)) return c;
  return 'en';
}

// Translate a key. Unknown key/key-lang pairs fall back to English, then to
// the key itself (so the UI never renders undefined).
function t(lang, key) {
  const L = STRINGS[lang] || STRINGS.en;
  return L[key] ?? STRINGS.en[key] ?? key;
}

// Full bundle for the frontend (small — chrome strings only).
function bundle(lang) {
  return { lang, rtl: RTL.has(lang), strings: STRINGS[lang] || STRINGS.en };
}

module.exports = { STRINGS, LANGUAGES, RTL, isSupported, parseAcceptLanguage, negotiate, t, bundle };
