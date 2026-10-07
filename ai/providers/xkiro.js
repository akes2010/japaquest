const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "xkiro",
  displayName: "xKiro",
  notes: "AI token aggregator — one key for 90+ models (Claude, GPT, Gemini, Kimi, Qwen, GLM, DeepSeek…). OpenAI-compatible at https://api.xkiro.com/v1. Free tier: 500K tokens/day across 40+ :free models, no card required (xkiro.com). Default model rides the free pool; set XKIRO_DEFAULT_MODEL or the admin model field to pin one.",
  baseURLEnv: "XKIRO_BASE_URL",
  defaultBaseURL: "https://api.xkiro.com/v1",
  apiKeyEnv: "XKIRO_API_KEY",
  defaultModel: process.env.XKIRO_DEFAULT_MODEL || "qwen/qwen3.7-max:free",
});
