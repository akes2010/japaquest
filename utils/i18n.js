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
    nav_chat: 'AI Travel Chat', nav_journey: 'My Journey', nav_explore: 'Explore Destinations',
    nav_book: 'Book Travel', nav_tools: 'Visa Tools', nav_saved: 'Saved Documents',
    nav_history: 'Chat History', nav_notifs: 'Notifications', nav_concierge: 'Human Help',
    nav_sub: 'Subscription', nav_profile: 'Profile',
    wiz_title: 'Turn your dream trip into a plan',
    wiz_lede: 'Describe the trip you\'re dreaming about. JapaQuest checks the verified visa rule for your passport, then builds a deadline-driven checklist — so a first-timer executes like an experienced traveller.',
    wiz_desc_label: 'Describe your dream trip',
    wiz_desc_ph: 'e.g. I want to take my family to London for 10 days next summer',
    wiz_dep: 'Departure date', wiz_ret: 'Return date', wiz_pax: 'Travellers',
    wiz_cta: '🧭 Build my plan',
    wiz_hint: 'Destination and trip purpose are detected from your description — or tell the AI chat and ask it to plan it.',
    suite_all: '← All eight products', suite_handled: 'handled.',
    suite_compare: 'Compare all lines', suite_continue: 'Continue through the suite',
    suite_disclaimer: 'Not a substitute for official embassy advice.',
    exp_sub: 'Real visa requirements from our verified database',
    exp_all: 'All', exp_loading: 'Loading visa database…',
    st_visa_free: '🟢 Visa-Free', st_voa: '🟡 On Arrival', st_evisa: '🔵 eVisa', st_eta: '🟣 eTA',
    st_visa_required: '🔴 Visa Required', st_check: 'Check Embassy',
    reg_africa: '🌍 Africa', reg_europe: '🏛️ Europe', reg_mideast: '🕌 Middle East',
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
    nav_chat: 'Chat voyage IA', nav_journey: 'Mon voyage', nav_explore: 'Explorer les destinations',
    nav_book: 'Réserver le voyage', nav_tools: 'Outils visa', nav_saved: 'Documents enregistrés',
    nav_history: 'Historique des chats', nav_notifs: 'Notifications', nav_concierge: 'Aide humaine',
    nav_sub: 'Abonnement', nav_profile: 'Profil',
    wiz_title: 'Transformez le voyage de vos rêves en plan',
    wiz_lede: 'Décrivez le voyage dont vous rêvez. JapaQuest vérifie la règle de visa vérifiée pour votre passeport, puis crée une liste à échéances — pour voyager comme un pro dès la première fois.',
    wiz_desc_label: 'Décrivez votre voyage de rêve',
    wiz_desc_ph: 'ex. Je veux emmener ma famille à Londres 10 jours l’été prochain',
    wiz_dep: 'Date de départ', wiz_ret: 'Date de retour', wiz_pax: 'Voyageurs',
    wiz_cta: '🧭 Créer mon plan',
    wiz_hint: 'La destination et le motif sont détectés depuis votre description — ou demandez au chat IA de le planifier.',
    suite_all: '← Les huit produits', suite_handled: 'réglé.',
    suite_compare: 'Comparer les lignes', suite_continue: 'Continuer dans la suite',
    suite_disclaimer: 'Ne remplace pas les conseils officiels de l’ambassade.',
    exp_sub: 'Vrais exigences de visa de notre base vérifiée',
    exp_all: 'Tous', exp_loading: 'Chargement de la base de visas…',
    st_visa_free: '🟢 Sans visa', st_voa: '🟡 À l’arrivée', st_evisa: '🔵 e-Visa', st_eta: '🟣 eTA',
    st_visa_required: '🔴 Visa requis', st_check: 'Vérifier l’ambassade',
    reg_africa: '🌍 Afrique', reg_europe: '🏛️ Europe', reg_mideast: '🕌 Moyen-Orient',
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
    nav_chat: 'Chat de viaje IA', nav_journey: 'Mi viaje', nav_explore: 'Explorar destinos',
    nav_book: 'Reservar viaje', nav_tools: 'Herramientas de visado', nav_saved: 'Documentos guardados',
    nav_history: 'Historial de chats', nav_notifs: 'Notificaciones', nav_concierge: 'Ayuda humana',
    nav_sub: 'Suscripción', nav_profile: 'Perfil',
    wiz_title: 'Convierte el viaje de tus sueños en un plan',
    wiz_lede: 'Describe el viaje que sueñas. JapaQuest verifica la regla de visado para tu pasaporte y crea una lista con fechas límite — para que un principiante viaje como un experto.',
    wiz_desc_label: 'Describe tu viaje soñado',
    wiz_desc_ph: 'p. ej. Quiero llevar a mi familia a Londres 10 días el próximo verano',
    wiz_dep: 'Fecha de salida', wiz_ret: 'Fecha de regreso', wiz_pax: 'Viajeros',
    wiz_cta: '🧭 Crear mi plan',
    wiz_hint: 'Detectamos destino y motivo de tu descripción — o pídeselo al chat de IA.',
    suite_all: '← Los ocho productos', suite_handled: 'resuelto.',
    suite_compare: 'Comparar las líneas', suite_continue: 'Continuar por la suite',
    suite_disclaimer: 'No sustituye el consejo oficial de la embajada.',
    exp_sub: 'Requisitos de visado reales de nuestra base verificada',
    exp_all: 'Todos', exp_loading: 'Cargando la base de visados…',
    st_visa_free: '🟢 Sin visado', st_voa: '🟡 A la llegada', st_evisa: '🔵 e-Visado', st_eta: '🟣 eTA',
    st_visa_required: '🔴 Visado requerido', st_check: 'Consultar embajada',
    reg_africa: '🌍 África', reg_europe: '🏛️ Europa', reg_mideast: '🕌 Oriente Medio',
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
    nav_chat: 'Chat de viagem IA', nav_journey: 'A minha viagem', nav_explore: 'Explorar destinos',
    nav_book: 'Reservar viagem', nav_tools: 'Ferramentas de visto', nav_saved: 'Documentos guardados',
    nav_history: 'Histórico de conversas', nav_notifs: 'Notificações', nav_concierge: 'Ajuda humana',
    nav_sub: 'Subscrição', nav_profile: 'Perfil',
    wiz_title: 'Transforme a viagem dos seus sonhos num plano',
    wiz_lede: 'Descreva a viagem com que sonha. O JapaQuest verifica a regra de visto do seu passaporte e cria uma lista com prazos — para viajar de primeira vez como um experiente.',
    wiz_desc_label: 'Descreva a viagem dos seus sonhos',
    wiz_desc_ph: 'ex. Quero levar a minha família a Londres 10 dias no próximo verão',
    wiz_dep: 'Data de partida', wiz_ret: 'Data de regresso', wiz_pax: 'Viajantes',
    wiz_cta: '🧭 Criar o meu plano',
    wiz_hint: 'O destino e o motivo são detetados da sua descrição — ou peça ao chat IA para planear.',
    suite_all: '← Os oito produtos', suite_handled: 'resolvido.',
    suite_compare: 'Comparar as linhas', suite_continue: 'Continuar na suite',
    suite_disclaimer: 'Não substitui o aconselhamento oficial da embaixada.',
    exp_sub: 'Requisitos de visto reais da nossa base verificada',
    exp_all: 'Todos', exp_loading: 'A carregar a base de vistos…',
    st_visa_free: '🟢 Sem visto', st_voa: '🟡 À chegada', st_evisa: '🔵 e-Visto', st_eta: '🟣 eTA',
    st_visa_required: '🔴 Visto necessário', st_check: 'Consultar embaixada',
    reg_africa: '🌍 África', reg_europe: '🏛️ Europa', reg_mideast: '🕌 Médio Oriente',
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
    nav_chat: 'محادثة السفر الذكية', nav_journey: 'رحلتي', nav_explore: 'استكشف الوجهات',
    nav_book: 'حجز السفر', nav_tools: 'أدوات التأشيرة', nav_saved: 'المستندات المحفوظة',
    nav_history: 'سجل المحادثات', nav_notifs: 'الإشعارات', nav_concierge: 'مساعدة بشرية',
    nav_sub: 'الاشتراك', nav_profile: 'الملف الشخصي',
    wiz_title: 'حوّل رحلة أحلامك إلى خطة',
    wiz_lede: 'صف الرحلة التي تحلم بها. يتحقق JapaQuest من قاعدة التأشيرة الموثقة لجوازك ثم يبني قائمة مهام بمواعيد نهائية — ليسافر المبتدئ كخبير.',
    wiz_desc_label: 'صف رحلة أحلامك',
    wiz_desc_ph: 'مثال: أريد اصطحاب عائلتي إلى لندن 10 أيام الصيف القادم',
    wiz_dep: 'تاريخ المغادرة', wiz_ret: 'تاريخ العودة', wiz_pax: 'المسافرون',
    wiz_cta: '🧭 ابنِ خطتي',
    wiz_hint: 'يتم اكتشاف الوجهة والغرض من وصفك — أو اطلب من المحادثة الذكية التخطيط.',
    suite_all: '← المنتجات الثمانية', suite_handled: 'جاهزة.',
    suite_compare: 'قارن جميع الخدمات', suite_continue: 'تابع في المجموعة',
    suite_disclaimer: 'ليست بديلاً عن نصيحة السفارة الرسمية.',
    exp_sub: 'متطلبات تأشيرة حقيقية من قاعدتنا الموثقة',
    exp_all: 'الكل', exp_loading: 'جارٍ تحميل قاعدة التأشيرات…',
    st_visa_free: '🟢 بدون تأشيرة', st_voa: '🟡 عند الوصول', st_evisa: '🔵 تأشيرة إلكترونية', st_eta: '🟣 eTA',
    st_visa_required: '🔴 تأشيرة مطلوبة', st_check: 'راجع السفارة',
    reg_africa: '🌍 أفريقيا', reg_europe: '🏛️ أوروبا', reg_mideast: '🕌 الشرق الأوسط',
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
    nav_chat: 'Mazungumzo ya AI', nav_journey: 'Safari yangu', nav_explore: 'Chunguza destinesheni',
    nav_book: 'Weka safari', nav_tools: 'Zana za viza', nav_saved: 'Hati zilizohifadhiwa',
    nav_history: 'Historia ya mazungumzo', nav_notifs: 'Arifa', nav_concierge: 'Msaada wa binadamu',
    nav_sub: 'Usajili', nav_profile: 'Wasifu',
    wiz_title: 'Geuza ndoto yako ya safari kuwa mpango',
    wiz_lede: 'Eleza safari unayoiota. JapaQuest hukagua sheria ya viza iliyothibitishwa kwa pasipoti yako, kisha hujenga orodha ya kazi na tarehe za mwisho — ili mgeni asafiri kama mtaalamu.',
    wiz_desc_label: 'Eleza safari yako ya ndoto',
    wiz_desc_ph: 'mf. Nataka kuchukua familia yangu London siku 10 majira ya joto ijayo',
    wiz_dep: 'Tarehe ya kuondoka', wiz_ret: 'Tarehe ya kurudi', wiz_pax: 'Wasafiri',
    wiz_cta: '🧭 Jenga mpango wangu',
    wiz_hint: 'Destinesheni na kusudi hutambuliwa kwenye maelezo yako — au uliza mazungumzo ya AI.',
    suite_all: '← Bidhaa zote nane', suite_handled: 'tayari.',
    suite_compare: 'Linganisha huduma zote', suite_continue: 'Endelea na seti',
    suite_disclaimer: 'Haibadilishi ushauri rasmi wa ubalozi.',
    exp_sub: 'Mahitaji halisi ya viza kutoka kwa hifadhidata yetu iliyothibitishwa',
    exp_all: 'Zote', exp_loading: 'Inapakia hifadhidata ya viza…',
    st_visa_free: '🟢 Bila viza', st_voa: '🟡 Ukiwasili', st_evisa: '🔵 e-Viza', st_eta: '🟣 eTA',
    st_visa_required: '🔴 Viza inahitajika', st_check: 'Angalia ubalozi',
    reg_africa: '🌍 Afrika', reg_europe: '🏛️ Ulaya', reg_mideast: '🕌 Mashariki ya Kati',
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
