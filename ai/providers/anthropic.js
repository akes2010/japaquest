/**
 * Anthropic's Messages API has a real shape difference from the OpenAI-
 * style providers: `system` is a top-level field (not a message with
 * role: 'system'), and the response's content is an array of typed
 * blocks rather than a single `choices[0].message.content` string.
 * That's different enough to not fit the shared factory cleanly.
 */

const API_BASE = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function chat({ messages, system, model, maxTokens = 800 }) {
  if (!isConfigured()) throw new Error("Anthropic is not configured — set ANTHROPIC_API_KEY");

  const res = await fetch(`${API_BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system: system || undefined,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Anthropic request failed (${res.status})`);

  const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!text) throw new Error("Anthropic returned no text content");
  return { text, raw: body, model: body.model };
}

module.exports = {
  key: "anthropic",
  displayName: "Anthropic (Claude)",
  notes: "Anthropic's Messages API. This is also what the frontend's Ask Japa tab calls directly when there's no backend connection — configuring it here lets a real production deployment route the same feature through your own server and API key instead.",
  isConfigured,
  chat,
};
