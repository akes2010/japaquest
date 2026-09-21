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
    desc: 'Ask anything in plain language — answers grounded in verified visa data, budgets and real trip logistics.',
    features: [
      ['🧠', 'Grounded answers', 'Every visa claim cites a source with authority tier and last-verified date — never forum guesswork.'],
      ['📝', 'Document writer', 'Embassy-ready cover letters, sponsorship letters and study intent letters in the format caseworkers expect.'],
      ['📅', 'Deadline-driven planning', 'Turns "I want to visit London next summer" into a dated execution checklist.'],
      ['🔗', 'Journey-aware', 'The AI knows your trips, readiness score and open cases — advice fits your actual timeline.'],
    ],
    cta: 'Ask your first question — free' },
  { key: 'visa',      icon: '🛂', name: 'JapaQuest Visa',      short: 'Visa, eligibility & documents',
    desc: 'Visa rules with cited sources, eligibility checks, deadline-driven checklists and embassy-ready letters.',
    features: [
      ['✅', 'Verified rulebook', 'Fees, processing times and conditions per passport and purpose — tiered sources, 90-day re-review.'],
      ['🎯', 'Readiness score', 'A living 0–100 score across every trip, with overdue penalties and passport-validity checks.'],
      ['⚠️', 'First-trip failure patterns', 'Aged bank statements, VFS slot scarcity, cross-document date mismatches — the traps forums never agree on.'],
      ['📄', 'Trip dossier', 'Export the whole plan — visa rule, forecast, checklist, document inventory — as a printable file.'],
    ],
    cta: 'Check your visa route' },
  { key: 'travel',    icon: '✈️', name: 'JapaQuest Travel',    short: 'Flights, hotels, tours & insurance',
    desc: 'Compare and book flights, stays, tours and cover — prices unchanged, small commission keeps the platform free.',
    features: [
      ['💸', 'Honest price context', 'Best months to fly, realistic nightly budgets and daily cost breakdowns before you book.'],
      ['🏨', 'Trusted partners', 'Flights, stays, car rentals, tours and insurance from name-brand partners via tracked links.'],
      ['🌍', 'Passport-aware', 'Suggestions respect visa requirements and transit rules for your passport.'],
      ['🛟', 'Cover that counts', 'Insurance options matched to visa requirements (Schengen-compliant cover included).'],
    ],
    cta: 'Plan a trip within budget' },
  { key: 'study',     icon: '🎓', name: 'JapaQuest Study',     short: 'Education & scholarships',
    desc: 'Universities, scholarship routes and study-permit pathways matched to your budget and passport.',
    features: [
      ['🏫', 'Route matching', 'Programs and countries matched to your grades, budget and passport strength.'],
      ['💰', 'Scholarship radar', 'Funding options and fully-funded pathways with realistic acceptance context.'],
      ['🛂', 'Study permits, decoded', 'Financial-proof expectations, dependant rules and post-study work rights per country.'],
      ['📅', 'Application timelines', 'Intake deadlines backwards-planned from statement and referee-ready dates.'],
    ],
    cta: 'Explore study routes' },
  { key: 'work',      icon: '💼', name: 'JapaQuest Work',      short: 'Work opportunities & permits',
    desc: 'Countries hiring your skills, work-permit rules and relocation-ready job routes.',
    features: [
      ['🧭', 'Skill-to-country fit', 'Where your profession is in demand, with visa sponsorship realism.'],
      ['📋', 'Permit pathways', 'Skilled-worker, digital-nomad and intra-company routes with requirements side by side.'],
      ['🧾', 'Document readiness', 'Qualifications, police certificates and apostilles tracked as deadline tasks.'],
      ['📈', 'Timeline honesty', 'Notice periods, processing times and job-market seasonality built into the plan.'],
    ],
    cta: 'Find your work route' },
  { key: 'move',      icon: '🏡', name: 'JapaQuest Move',      short: 'Relocation & property',
    desc: 'End-to-end relocation planning: housing, banking, healthcare and settling-in timelines.',
    features: [
      ['📦', 'The whole move, planned', 'Housing, banking, healthcare, schooling and shipping as one dated checklist.'],
      ['🏦', 'Money logistics', 'Account opening rules, proof-of-address traps and realistic cost-of-living budgets.'],
      ['🏠', 'Renting before you land', 'Viewing norms, deposit customs and scam patterns per city.'],
      ['🤝', 'Settling-in support', 'First-90-days guidance from SIM registration to healthcare enrolment.'],
    ],
    cta: 'Plan your relocation' },
  { key: 'business',  icon: '🏢', name: 'JapaQuest Business',  short: 'Corporate & business travel',
    desc: 'Group bookings, conference trips and travel policy built for companies and delegations.',
    features: [
      ['👥', 'Group coordination', 'Delegation visas, group bookings and shared itineraries handled as one plan.'],
      ['📊', 'Travel policy built-in', 'Approval flows and budget guardrails sized for SMEs and teams.'],
      ['🗓️', 'Event trips, decoded', 'Conference and trade-fair visas with invitation-letter checklists.'],
      ['🧾', 'Cost visibility', 'Per-traveller cost breakdowns your finance team will actually accept.'],
    ],
    cta: 'Set up business travel' },
  { key: 'concierge', icon: '🤝', name: 'JapaQuest Concierge', short: 'Human assistance',
    desc: 'A real human in your corner for the moments that matter — escalation from the AI, on demand.',
    features: [
      ['🚨', 'One-tap escalation', 'Stuck on a rejection, a slot crisis or a tricky case? Escalate straight from the AI chat.'],
      ['💬', 'Threaded case handling', 'Every request is a tracked ticket with replies, status and full history.'],
      ['🎯', 'Context travels with you', 'The agent sees your journeys and readiness — you never re-explain your case.'],
      ['⏱️', 'Status you can see', 'Open → answered → closed, with in-app notifications at every turn.'],
    ],
    cta: 'Meet your human concierge' },
];

// Concierge SLA — first-response targets in hours, per ticket priority.
const SLA_POLICY = [
  { key: 'urgent',    label: 'Urgent',    hours: 2,  color: '#c0392b' },
  { key: 'high',      label: 'High',      hours: 8,  color: '#d35400' },
  { key: 'normal',    label: 'Normal',    hours: 24, color: '#b8860b' },
  { key: 'low',       label: 'Low',       hours: 72, color: '#6b705c' },
];
const slaFor = p => SLA_POLICY.find(s => s.key === p) || SLA_POLICY[2];

module.exports = { NAME, TAGLINE, SUITE, SLA_POLICY, slaFor };
