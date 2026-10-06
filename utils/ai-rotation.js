'use strict';
/**
 * AI auto-rotation — "Auto" mode for JapaQuest.
 *
 * The user picks ♾️ Auto and the system continuously switches providers for
 * them: every request starts from a rotating offset in the plan's provider
 * pool (spreading load across free tiers), providers that just failed or got
 * rate-limited go into a short cooldown, and the chain walk continues until
 * someone answers. Which providers are in the pool depends on the client's
 * plan — free plans ride the free pools, paid plans unlock premium models.
 */
const { Q } = require('../db');

// ── Provider pools per plan tier ─────────────────────────────────────────────
// ids match registry/routes dispatch ids. Engine locals are tried first when
// the self-hosted engine is up (they're free and fast); 'auto' itself is
// resolved by this module, never included.
const FREE_POOL = [
  'llama-local', 'qwen-local', 'deepseek-local',   // self-hosted engine (skipped when offline)
  'omniroute',                                      // free AI gateway (90+ free models)
  'deepseek', 'qwen', 'llama', 'gemma', 'mistral',  // OpenRouter free tier
  'llama-groq', 'mixtral-groq',                     // Groq free tier
  'gemini-flash',                                   // Google free tier
  'cloudflare',                                     // Workers AI free tier
  'mistral7b',                                      // HuggingFace free tier
];
const PREMIUM_EXTRA = ['kimi', 'zai', 'deepseek2', 'llama-together', 'gemini-pro', 'openai', 'claude'];
// Quality-ordered premium tail for Unlimited: best models first.
const ULTIMATE_EXTRA = ['zai', 'kimi', 'claude', 'openai', 'gemini-pro', 'deepseek2'];

const TIER_POOLS = {
  free:      [...FREE_POOL],
  explorer:  [...FREE_POOL, ...PREMIUM_EXTRA.slice(0, 3)],              // + kimi, zai, deepseek2
  voyager:   [...FREE_POOL, ...PREMIUM_EXTRA],                          // + all premium
  unlimited: [...FREE_POOL, ...ULTIMATE_EXTRA, ...PREMIUM_EXTRA],       // quality-ordered first
};

function tierForPlan(plan) {
  if (!plan) return 'free';
  const slug = String(plan.slug || '').toLowerCase();
  if (TIER_POOLS[slug]) return slug;
  const daily = Number(plan.daily_limit || 0);
  if (plan.id >= 4 || daily >= 99999) return 'unlimited';
  if (plan.id === 3) return 'voyager';
  if (plan.id === 2) return 'explorer';
  return 'free';
}

function poolForTier(tier) {
  return TIER_POOLS[tier] || TIER_POOLS.free;
}

// ── Configuration checks (env first, then admin settings) ────────────────────
const CONFIG_CHECKS = {
  'llama-local':    () => true, // engine reachability is checked at dispatch time
  'qwen-local':     () => true,
  'deepseek-local': () => true,
  omniroute:        () => !!(process.env.OMNIROUTE_BASE_URL || setting('ai_omniroute_url') || process.env.OMNIROUTE_API_KEY || setting('ai_omniroute_key')),
  cloudflare:       () => !!((process.env.CLOUDFLARE_ACCOUNT_ID || setting('ai_cloudflare_account')) && (process.env.CLOUDFLARE_API_TOKEN || setting('ai_cloudflare_token'))),
  kimi:             () => !!(process.env.KIMI_API_KEY || setting('ai_kimi_key')),
  zai:              () => !!(process.env.ZAI_API_KEY || setting('ai_zai_key')),
  claude:           () => !!(process.env.ANTHROPIC_API_KEY || setting('ai_anthropic_key')),
  openai:           () => !!(process.env.OPENAI_API_KEY || setting('ai_openai_key')),
  deepseek:         () => !!(process.env.OPENROUTER_API_KEY || setting('ai_openrouter_key')),
  qwen:             () => !!(process.env.OPENROUTER_API_KEY || setting('ai_openrouter_key')),
  llama:            () => !!(process.env.OPENROUTER_API_KEY || setting('ai_openrouter_key')),
  gemma:            () => !!(process.env.OPENROUTER_API_KEY || setting('ai_openrouter_key')),
  mistral:          () => !!(process.env.OPENROUTER_API_KEY || setting('ai_openrouter_key')),
  'llama-groq':     () => !!(process.env.GROQ_API_KEY || setting('ai_groq_key')),
  'mixtral-groq':   () => !!(process.env.GROQ_API_KEY || setting('ai_groq_key')),
  'gemini-flash':   () => !!(process.env.GEMINI_API_KEY || setting('ai_gemini_key')),
  'gemini-pro':     () => !!(process.env.GEMINI_API_KEY || setting('ai_gemini_key')),
  'llama-together': () => !!(process.env.TOGETHER_API_KEY || setting('ai_together_key')),
  deepseek2:        () => !!(process.env.DEEPSEEK_API_KEY || setting('ai_deepseek_key')),
  mistral7b:        () => !!(process.env.HUGGINGFACE_API_KEY || setting('ai_huggingface_key')),
};

function setting(key) { try { return Q.getSetting(key) || ''; } catch { return ''; } }
function isConfigured(id) {
  const check = CONFIG_CHECKS[id];
  return check ? !!check() : false;
}

// ── Cooldowns: failed/rate-limited providers sit out for a bit ────────────────
const COOLDOWN_MS = 60 * 1000;
const cooldowns = new Map(); // provider id → until (epoch ms)

function coolDown(id, ms = COOLDOWN_MS) { cooldowns.set(id, Date.now() + ms); }
function isCooling(id) { return (cooldowns.get(id) || 0) > Date.now(); }
function clearCooldown(id) { cooldowns.delete(id); }

/** Classify an error for cooldown policy: rate limits cool longest. */
function noteFailure(id, err) {
  const msg = String((err && err.message) || err || '');
  const ms = /rate limit|429|quota|too many/i.test(msg) ? 5 * 60 * 1000
    : /401|403|invalid.*key|unauthorized|not configured/i.test(msg) ? 15 * 60 * 1000
    : COOLDOWN_MS;
  coolDown(id, ms);
  return ms;
}

// ── Rotation: each request starts at the next offset → continuous switching ──
let counter = 0;

/**
 * Build the ordered provider chain for one request:
 *   • only providers whose keys are actually configured
 *   • skips providers in cooldown
 *   • rotates the starting point so successive requests spread the load
 * The local engine is always first when present (it's free), and rotation
 * applies to the cloud tail.
 */
function buildChain(plan, { engineOnline = false, engineFamilies = [] } = {}) {
  const tier = tierForPlan(plan);
  const pool = poolForTier(tier).filter(id => id !== 'llama-local' || true); // keep ids stable
  const engineUp = id => id.endsWith('-local') && engineOnline && engineFamilies.includes(id.replace(/-local$/, ''));

  const ready = pool.filter(id => isConfigured(id) && !isCooling(id) && (id.endsWith('-local') ? engineUp(id) : true));

  // Locals first (free, yours), then the cloud tail rotated by the counter.
  const locals = ready.filter(id => id.endsWith('-local'));
  let cloud = ready.filter(id => !id.endsWith('-local'));
  const offset = (counter++) % Math.max(cloud.length, 1);
  cloud = cloud.slice(offset).concat(cloud.slice(0, offset));

  // Premium tail ordering for unlimited: keep the quality-first ids in front.
  if (tier === 'unlimited') {
    const pref = ULTIMATE_EXTRA.filter(id => cloud.includes(id));
    const rest = cloud.filter(id => !pref.includes(id));
    cloud = [...pref, ...rest];
  }
  return [...locals, ...cloud];
}

/** Public snapshot for the admin/status endpoints. */
function rotationStatus(plan, engine) {
  const tier = tierForPlan(plan);
  const pool = poolForTier(tier);
  return {
    tier,
    pool,
    configured: pool.filter(isConfigured),
    cooling: [...cooldowns.entries()].filter(([, until]) => until > Date.now())
      .map(([id, until]) => ({ id, resetsInMs: until - Date.now() })),
    engineOnline: !!(engine && engine.online),
    requestsServed: counter,
  };
}

module.exports = {
  TIER_POOLS, tierForPlan, poolForTier, buildChain, isConfigured,
  coolDown, isCooling, clearCooldown, noteFailure, rotationStatus,
};
