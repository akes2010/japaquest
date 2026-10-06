'use strict';
/**
 * Self-hosted AI Engine — the orchestration brain that puts Llama / Qwen /
 * DeepSeek running on YOUR hardware at the front of every request chain,
 * with the cloud providers (OpenRouter, Groq, Gemini, Claude, …) following
 * as fallbacks.
 *
 * Chain shape (per request):
 *   [ self-hosted engine ]  →  cloud fallbacks (local family first)  →  error
 *
 * The engine auto-detects which runtimes are actually up (Ollama / vLLM /
 * LM Studio) and which model families each one serves, so "main engine"
 * means: if the box can serve llama locally, llama-local runs the show and
 * the paid APIs are only billed when the engine can't answer.
 */
const { Q } = require('../db');

// ── Engine runtimes (checked in order) ───────────────────────────────────────
const RUNTIMES = [
  { key: 'ollama',  label: 'Ollama',   icon: '🏠', urlSetting: 'ai_ollama_url',   urlEnv: 'OLLAMA_BASE_URL',  defaultUrl: 'http://localhost:11434', keySetting: 'ai_ollama_key',   keyEnv: 'OLLAMA_API_KEY',  modelsPath: '/v1/models' },
  { key: 'vllm',    label: 'vLLM',     icon: '⚡', urlSetting: 'ai_vllm_url',     urlEnv: 'VLLM_BASE_URL',    defaultUrl: 'http://localhost:8000',  keySetting: 'ai_vllm_key',    keyEnv: 'VLLM_API_KEY',    modelsPath: '/v1/models' },
  { key: 'lmstudio',label: 'LM Studio',icon: '🧪', urlSetting: 'ai_lmstudio_url', urlEnv: 'LMSTUDIO_BASE_URL',defaultUrl: 'http://localhost:1234',  keySetting: 'ai_lmstudio_key',keyEnv: 'LMSTUDIO_API_KEY',modelsPath: '/v1/models' },
];

// Model-family detection from an engine's served model ids. The family is
// what routes a user-visible model id (llama-local) to a concrete model.
const FAMILIES = [
  { id: 'llama',    localId: 'llama-local',    cloudId: 'meta-llama/llama-3.3-70b-instruct',     match: /llama|meta-llama/i },
  { id: 'qwen',     localId: 'qwen-local',     cloudId: 'qwen/qwen-2.5-72b-instruct',           match: /qwen/i },
  { id: 'deepseek', localId: 'deepseek-local', cloudId: 'deepseek/deepseek-r1',                 match: /deepseek/i },
  { id: 'gemma',    localId: 'gemma-local',    cloudId: 'google/gemma-3-27b-it',                match: /gemma/i },
  { id: 'mistral',  localId: 'mistral-local',  cloudId: 'mistralai/mistral-7b-instruct',        match: /mistral|mixtral/i },
];

const FAMILY_META = {
  llama:    { name: 'Llama 3.x (Self-hosted)',    icon: '🦙' },
  qwen:     { name: 'Qwen 2.5 (Self-hosted)',     icon: '🧠' },
  deepseek: { name: 'DeepSeek R1 (Self-hosted)',  icon: '🔍' },
  gemma:    { name: 'Gemma 3 (Self-hosted)',      icon: '💎' },
  mistral:  { name: 'Mistral (Self-hosted)',      icon: '🌪️' },
};

function s(k, dflt) { try { return Q.getSetting(k) || dflt; } catch { return dflt; } }

/** Prefer .env value, then admin-panel setting, then built-in default. */
function runtimeBase(rt) {
  return (process.env[rt.urlEnv] || s(rt.urlSetting, '') || rt.defaultUrl)
    .replace(/\/+$/, '')      // trailing slashes
    .replace(/\/v1$/i, '');   // some setups include /v1 — we always append it ourselves
}
function runtimeKey(rt) {
  return process.env[rt.keyEnv] || s(rt.keySetting, '') || '';
}
function engineModelList() {
  // Env var wins (documented in .env.example), then admin-panel setting.
  const raw = process.env.AI_ENGINE_MODELS || s('ai_engine_models', 'llama3.1,qwen2.5:7b,deepseek-r1:8b') || '';
  return String(raw).split(',').map(x => x.trim()).filter(Boolean);
}
function fallbackEnabled() {
  const raw = process.env.AI_ENGINE_FALLBACK || s('ai_engine_fallback', '1');
  return String(raw) !== '0';
}

/**
 * Probe one runtime: is it up and which model families does it serve?
 * Never throws — a down runtime is just { up:false }.
 */
async function probeRuntime(rt) {
  const base = runtimeBase(rt);
  const url = base + rt.modelsPath;
  const headers = {};
  const key = runtimeKey(rt);
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    const fetch = require('node-fetch');
    const r = await fetch(url, { headers, timeout: 2500 }); // node-fetch v2 native timeout
    if (!r.ok) return { ...rt, up: false, base, error: `HTTP ${r.status}` };
    const d = await r.json();
    const ids = (d.data || d.models || []).map(m => (typeof m === 'string' ? m : (m.id || m.name || '')));
    const families = FAMILIES.filter(f => ids.some(id => f.match.test(id))).map(f => f.id);
    return { ...rt, up: true, base, models: ids.slice(0, 20), families };
  } catch (e) {
    return { ...rt, up: false, base, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'unreachable') };
  }
}

/** Probe every configured runtime (one with an explicit URL set, or the default Ollama). */
async function engineStatus() {
  const results = await Promise.all(RUNTIMES.map(probeRuntime));
  const up = results.filter(r => r.up);
  const families = [...new Set(up.flatMap(r => r.families))];
  return {
    online: up.length > 0,
    runtimes: results.map(({ key, label, icon, up: isUp, base, models, families: fams, error }) =>
      ({ key, label, icon, up: isUp, base, models: models || [], families: fams || [], error: error || null })),
    families,               // e.g. ['llama','qwen','deepseek']
    modelCount: up.reduce((n, r) => n + (r.models ? r.models.length : 0), 0),
    fallback: fallbackEnabled(),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Which local model id (llama-local / qwen-local / …) can the engine serve?
 * Returns the first local id whose family is online, or null.
 */
async function servedLocalModel(preferredLocalId) {
  const status = await engineStatus();
  if (!status.online) return null;
  if (preferredLocalId && status.families.includes(preferredLocalId.replace(/-local$/, ''))) {
    return preferredLocalId;
  }
  const first = status.families[0];
  return first ? first + '-local' : null;
}

/**
 * Concrete (url, key, model) to call on the engine for a local model id.
 * Prefers the exact requested family; falls back to any family the engine
 * actually serves. Returns null when the engine can't serve that family.
 */
async function engineTarget(localModelId, convModel) {
  const status = await engineStatusCached(5000);
  if (!status.online) return null;
  const famId = String(localModelId || '').replace(/-local$/, '');
  const fam = FAMILIES.find(f => f.id === famId) ||
              FAMILIES.find(f => status.families.includes(f.id)) || null;
  if (!fam) return null;
  const runtime = status.runtimes.find(r => r.up && r.families.includes(fam.id)) ||
                  status.runtimes.find(r => r.up);
  if (!runtime) return null;

  // Concrete model name: the per-request model or OLLAMA_MODEL if it matches
  // the family, else the first served id from that family, else the admin's
  // engine list, else the family's canonical name.
  const envModel = process.env.OLLAMA_MODEL || '';
  const wanted = ((convModel && fam.match.test(convModel)) ? convModel : envModel);
  const served = (runtime.models || []).find(m => fam.match.test(m));
  const listed = engineModelList().find(m => fam.match.test(m));
  const model = (wanted && fam.match.test(wanted)) ? wanted
              : served || listed || fam.id;
  return { runtime: runtime.key, base: runtime.base, key: runtimeKey(runtime), model };
}

/** OpenAI-compatible chat call against the engine. Returns reply text. */
async function engineChat({ base, key, model, messages, system, maxTokens }) {
  const fetch = require('node-fetch');
  const r = await fetch(base + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))],
    }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Engine ${r.status}`);
  }
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Engine returned empty reply');
  return text;
}

/**
 * Fallback chain for a local model id: cloud providers that serve the same
 * family first, then the generic cloud list. Shape mirrors routes/ai.js
 * entries so the dispatcher can execute them directly.
 */
function cloudFallbacksFor(localModelId) {
  if (!fallbackEnabled()) return [];
  const fam = FAMILIES.find(f => f.localId === localModelId);
  const chain = [];
  const push = (modelId) => { if (modelId && !chain.includes(modelId)) chain.push(modelId); };
  if (fam) {
    // 1. Same family on OpenRouter's free tier — closest match to the local model.
    push(fam.id); // ids match the OpenRouter slots: llama/qwen/deepseek/gemma/mistral
    // 2. Same family on fast/cheap dedicated providers.
    if (fam.id === 'llama')    { push('llama-groq'); push('llama-together'); }
    if (fam.id === 'mistral')  { push('mixtral-groq'); }
    if (fam.id === 'deepseek') { push('deepseek2'); }
    // 3. Other free OpenRouter families as a broader safety net.
    for (const f of FAMILIES) push(f.id);
  }
  // 4. Generic tail — whatever else is configured.
  push('llama-groq'); push('deepseek'); push('openai'); push('gemini-flash'); push('claude');
  // Never fall back to a *local* id (that would loop) — filter them out.
  return chain.filter(id => !id.endsWith('-local'));
}

// Best-effort runtime cache so /api/ai/models doesn't probe on every hit.
let _statusCache = null;
async function engineStatusCached(maxAgeMs = 15000) {
  if (_statusCache && Date.now() - _statusCache.t < maxAgeMs) return _statusCache.v;
  const v = await engineStatus();
  _statusCache = { t: Date.now(), v };
  return v;
}
function invalidateEngineCache() { _statusCache = null; }

module.exports = {
  FAMILIES, FAMILY_META, RUNTIMES,
  engineStatus, engineStatusCached, invalidateEngineCache,
  servedLocalModel, engineTarget, engineChat, cloudFallbacksFor,
  fallbackEnabled, engineModelList,
};
