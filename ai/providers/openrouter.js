const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "openrouter",
  displayName: "OpenRouter",
  notes: "Routes to many underlying models through one API — useful if you want to switch models without switching integrations. Model string determines which underlying model actually answers, e.g. 'anthropic/claude-3.5-sonnet' or 'meta-llama/llama-3.1-70b-instruct'.",
  baseURLEnv: "OPENROUTER_BASE_URL",
  defaultBaseURL: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
  defaultModel: process.env.OPENROUTER_DEFAULT_MODEL || "openai/gpt-4o-mini",
  // OpenRouter recommends (not strictly requires) these for their leaderboard/analytics.
  extraHeaders: {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://japa.app",
    "X-Title": "Japa AI Visa Agent",
  },
});
