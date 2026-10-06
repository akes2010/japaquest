'use strict';
/**
 * Factory for OpenAI-compatible chat providers.
 *
 * Every provider that speaks the standard /chat/completions shape (OpenAI,
 * Kimi, z.ai, OmniRoute, Groq, Together, DeepSeek, OpenRouter, Ollama, …)
 * is a thin config over this. Providers with a genuinely different wire
 * format (Anthropic messages, Cloudflare /ai/run, Gemini, HuggingFace)
 * implement their own module instead.
 *
 * Config options:
 *   key, displayName, notes        — identity
 *   baseURLEnv / defaultBaseURL    — endpoint base (a /chat/completions path
 *                                    is appended unless the base already ends
 *                                    with /chat/completions)
 *   apiKeyEnv / apiKeyRequired     — credentials (default: required)
 *   defaultModel                   — model id used when none is passed
 *   extraHeaders                   — optional static headers (e.g. OpenRouter
 *                                    referer/title)
 *   requireExplicitBaseURL         — warn-not-fail when the base URL is left
 *                                    at the localhost default on a server
 */
function resolveBase(cfg) {
  const env = cfg.baseURLEnv ? process.env[cfg.baseURLEnv] : '';
  const url = String(env || cfg.defaultBaseURL || '').replace(/\/+$/, '');
  return url;
}

function resolveKey(cfg) {
  return cfg.apiKeyEnv ? (process.env[cfg.apiKeyEnv] || '') : '';
}

function makeOpenAICompatibleProvider(cfg) {
  function isConfigured() {
    if (cfg.apiKeyRequired === false) return true; // keyless gateways: base URL presence is enough
    return !!resolveKey(cfg);
  }

  async function chat({ messages, system, model, maxTokens = 800 }) {
    const base = resolveBase(cfg);
    if (!base) throw new Error(`${cfg.displayName}: no base URL configured (set ${cfg.baseURLEnv})`);
    const key = resolveKey(cfg);
    if (!key && cfg.apiKeyRequired !== false) {
      throw new Error(`${cfg.displayName}: API key not configured (set ${cfg.apiKeyEnv})`);
    }

    const url = /chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(cfg.extraHeaders || {}),
      },
      body: JSON.stringify({
        model: model || cfg.defaultModel,
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
      }),
    });

    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (body.error && (body.error.message || String(body.error)))
        || body.message || `${cfg.displayName} error ${r.status}`;
      if (r.status === 429) throw new Error('Rate limit: ' + msg);
      if (r.status === 401 || r.status === 403) throw new Error('Invalid API key: ' + msg);
      throw new Error(msg);
    }
    const text = body.choices?.[0]?.message?.content || '';
    if (!text) throw new Error(`${cfg.displayName} returned no text content`);
    return { text, raw: body, model: body.model || model };
  }

  return {
    key: cfg.key,
    displayName: cfg.displayName,
    notes: cfg.notes || '',
    isConfigured,
    chat,
  };
}

module.exports = { makeOpenAICompatibleProvider, resolveBase, resolveKey };
