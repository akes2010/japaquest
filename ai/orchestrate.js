'use strict';
/**
 * Multi-phase model handoff — the orchestrator-agent pattern from the
 * operator playbook: ONE taskMemory thread flows through a chain of models
 * (planner → coder → …), every phase continuing exactly where the previous
 * one stopped, because the full conversation history is handed over — the
 * same shape as the OpenAI snippets:
 *
 *   taskMemory = [system, user(prompt)]            ← shared timeline
 *   phase 1: push {user: "plan it"}  → reasoning model → push its reply
 *   phase 2: push {user: "execute"}  → coding model   → push its reply
 *
 * Phase model resolution, in order:
 *   1. exact ENGINE TAG  — 'deepseek-r1', 'phi4', 'qwen2.5-coder:7b', …
 *                          served by AI_BASE_URL / Ollama / vLLM / LM Studio
 *   2. family local id   — 'llama-local' / 'qwen-local' / … (engine first,
 *                          then the family's cloud fallbacks)
 *   3. registry cloud id — 'deepseek', 'qwen3coder', 'laguna', 'flowise', …
 *   4. ♾️ auto rotation  — ALWAYS appended: the plan's rotation pool closes
 *                          every phase, so a workflow never dies on one dead
 *                          provider ("automatically rotating unlimitedly").
 *
 * Cloud dispatch + the auto-walk live in routes/ai.js and are injected as
 * `deps` (avoids a circular require); everything engine-side is imported
 * here directly. Pure logic — no Express, no response objects.
 */
const { isLocalModel } = require('./registry');
const { engineTagTarget, engineTarget, engineChat, cloudFallbacksFor } = require('./orchestrator');

// Operator-playbook defaults: plan with a reasoning model, execute with a
// coding model — overridable per call (body.phases[]) or per box (ORCH_* env).
const DEFAULT_PHASES = [
  { name: 'plan',    model: process.env.ORCH_PLAN_MODEL    || 'deepseek-r1',      prompt: 'Phase 1: Break this task down into a step-by-step resolution plan.' },
  { name: 'execute', model: process.env.ORCH_EXECUTE_MODEL || 'qwen2.5-coder:7b', prompt: 'Phase 2: Using the plan above, produce the final answer (or the code). Continue from the exact state of the plan.' },
];

const PHASE_TIMEOUT_MS = parseInt(process.env.ORCH_PHASE_TIMEOUT_MS || '120000', 10) || 120000;
const MAX_PHASES = 6;

function withTimeout(promise, ms, what) {
  let t;
  const cap = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    if (t.unref) t.unref();
  });
  return Promise.race([promise, cap]).finally(() => clearTimeout(t));
}

/**
 * Ordered candidate runners for one phase model string. Each candidate is
 * { label, run(taskMemory, system, maxTokens) → text }.
 */
async function buildCandidates(modelStr, deps) {
  const { isCloudId, dispatchCloud, autoChat, plan } = deps;
  const m = String(modelStr || '').trim();
  const out = [];
  const add = (label, run) => { if (label && !out.some(c => c.label === label)) out.push({ label, run }); };

  // 1. exact tag on the engine (AI_BASE_URL / Ollama / vLLM / LM Studio)
  const tag = await engineTagTarget(m).catch(() => null);
  if (tag) add(`${m}@${tag.runtime}`, (msgs, sys, mt) => engineChat({ ...tag, messages: msgs, system: sys, maxTokens: mt }));

  // 2. family local id — engine first, then that family's cloud fallbacks
  else if (isLocalModel(m)) {
    const t = await engineTarget(m, '').catch(() => null);
    if (t) add(`${m}@${t.runtime} (${t.model})`, (msgs, sys, mt) => engineChat({ ...t, messages: msgs, system: sys, maxTokens: mt }));
    for (const fb of cloudFallbacksFor(m)) add(`${m} → ${fb}`, (msgs, sys, mt) => dispatchCloud(fb, msgs, sys, mt));
  }

  // 3. registry cloud id
  else if (m && m !== 'auto' && isCloudId(m)) add(m, (msgs, sys, mt) => dispatchCloud(m, msgs, sys, mt));

  // 4. never let a workflow die — the ♾️ rotation pool closes every phase
  add('auto (rotation)', (msgs, sys, mt) => autoChat({ plan, messages: msgs, system: sys, maxTokens: mt }).then(r => r.reply));

  return out;
}

async function runPhase(phase, taskMemory, system, deps, maxTokens) {
  const attempts = [];
  const candidates = await buildCandidates(phase.model, deps);
  for (const c of candidates) {
    try {
      const text = await withTimeout(
        Promise.resolve(c.run(taskMemory, system, maxTokens)),
        PHASE_TIMEOUT_MS,
        `phase "${phase.name}" on ${c.label}`
      );
      if (!text || !String(text).trim()) throw new Error('empty reply');
      return { servedBy: c.label, output: String(text) };
    } catch (e) {
      attempts.push(`${c.label}: ${String(e.message).slice(0, 80)}`);
      if (deps.reportFailure && /^[a-z0-9-]+$/.test(c.label)) deps.reportFailure(c.label, e);
    }
  }
  throw new Error(`phase "${phase.name}" (${phase.model}) failed on every provider — ${attempts.slice(0, 3).join(' · ')}`);
}

/**
 * Run the whole workflow. Response shape mirrors the operator snippet
 * ({ planCreatedByPhi4, executedByQwen }) generalized to N phases:
 *   { success, phases:[{phase, requestedModel, servedBy, output}], final, plan }
 */
async function runWorkflow({ prompt, phases, system, maxTokens = 1200, deps, log }) {
  if (!deps || typeof deps.dispatchCloud !== 'function' || typeof deps.autoChat !== 'function') {
    throw new Error('orchestrate deps missing (dispatchCloud/autoChat)');
  }
  const spec = (Array.isArray(phases) && phases.length ? phases : DEFAULT_PHASES).slice(0, MAX_PHASES).map((p, i) => ({
    name: p.name || p.role || `phase-${i + 1}`,
    model: String(p.model || (i === 0 ? DEFAULT_PHASES[0].model : DEFAULT_PHASES[1].model)),
    prompt: String(p.prompt || `Phase ${i + 1}: continue the task, building on everything above.`),
  }));
  const taskMemory = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];
  const results = [];
  for (const ph of spec) {
    taskMemory.push({ role: 'user', content: ph.prompt });
    const r = await runPhase(ph, taskMemory, system, deps, maxTokens);
    taskMemory.push({ role: 'assistant', content: r.output });
    results.push({ phase: ph.name, requestedModel: ph.model, servedBy: r.servedBy, output: r.output });
    if (typeof log === 'function') log(`[AI:orchestrate] ${ph.name} → ${r.servedBy} (${r.output.length} chars)`);
  }
  return {
    success: true,
    phases: results,
    final: results[results.length - 1].output,
    // snippet-compat keys (their client read these directly)
    planCreatedBy: results[0] ? results[0].output : '',
    executedBy: results[results.length - 1].servedBy,
    taskMemoryMessages: taskMemory.length,
  };
}

module.exports = { runWorkflow, buildCandidates, DEFAULT_PHASES, MAX_PHASES };
