'use strict';
/**
 * Cloudflare Workers AI — REST provider.
 *
 * Shape differs from OpenAI-style providers: POST to
 *   https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{MODEL}
 * with `messages` directly, response body is { result: { response }, success }.
 * Needs both CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI free
 * tier includes a generous daily neuron allocation at no cost).
 */
const API_BASE = 'https://api.cloudflare.com/client/v4/accounts';

function accountId() { return process.env.CLOUDFLARE_ACCOUNT_ID || ''; }
function token() { return process.env.CLOUDFLARE_API_TOKEN || ''; }

function isConfigured() {
  return !!(accountId() && token());
}

async function chat({ messages, system, model, maxTokens = 800 }) {
  if (!isConfigured()) throw new Error('Cloudflare Workers AI is not configured — set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  const m = model || process.env.CLOUDFLARE_DEFAULT_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  const r = await fetch(`${API_BASE}/${accountId()}/ai/run/${m}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages.map(x => ({ role: x.role, content: x.content })),
      ],
      max_tokens: maxTokens,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.success === false) {
    const msg = (body.errors && body.errors[0] && (body.errors[0].message || String(body.errors[0]))) || `Cloudflare ${r.status}`;
    if (r.status === 429) throw new Error('Rate limit: ' + msg);
    throw new Error(msg);
  }
  const text = (body.result && (body.result.response || body.result.text)) || '';
  if (!text) throw new Error('Cloudflare returned no text content');
  return { text, raw: body, model: m };
}

module.exports = { key: 'cloudflare', displayName: 'Cloudflare Workers AI', isConfigured, chat };
