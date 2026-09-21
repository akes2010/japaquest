'use strict';
/**
 * JapaQuest brand — single source of truth.
 *
 * Everything server-side that needs the brand (banners, emails, AI persona,
 * dossier footers) reads from here. The admin can still override app_name /
 * app_tagline / smtp_from_name via Settings — these are just the defaults
 * and the fallbacks when a setting is empty.
 */

const NAME = 'JapaQuest';
const TAGLINE = 'Your Journey. Our Intelligence.';

/** The JapaQuest product suite, in canonical order. */
const SUITE = [
  { key: 'ai',        icon: '💬', name: 'JapaQuest AI',        short: 'Conversational AI travel agent',
    desc: 'Ask anything in plain language — answers grounded in verified visa data, budgets and real trip logistics.' },
  { key: 'visa',      icon: '🛂', name: 'JapaQuest Visa',      short: 'Visa, eligibility & documents',
    desc: 'Visa rules with cited sources, eligibility checks, deadline-driven checklists and embassy-ready letters.' },
  { key: 'travel',    icon: '✈️', name: 'JapaQuest Travel',    short: 'Flights, hotels, tours & insurance',
    desc: 'Compare and book flights, stays, tours and cover — prices unchanged, small commission keeps the platform free.' },
  { key: 'study',     icon: '🎓', name: 'JapaQuest Study',     short: 'Education & scholarships',
    desc: 'Universities, scholarship routes and study-permit pathways matched to your budget and passport.' },
  { key: 'work',      icon: '💼', name: 'JapaQuest Work',      short: 'Work opportunities & permits',
    desc: 'Countries hiring your skills, work-permit rules and relocation-ready job routes.' },
  { key: 'move',      icon: '🏡', name: 'JapaQuest Move',      short: 'Relocation & property',
    desc: 'End-to-end relocation planning: housing, banking, healthcare and settling-in timelines.' },
  { key: 'business',  icon: '🏢', name: 'JapaQuest Business',  short: 'Corporate & business travel',
    desc: 'Group bookings, conference trips and travel policy built for companies and delegations.' },
  { key: 'concierge', icon: '🤝', name: 'JapaQuest Concierge', short: 'Human assistance',
    desc: 'A real human in your corner for the moments that matter — escalation from the AI, on demand.' },
];

module.exports = { NAME, TAGLINE, SUITE };
