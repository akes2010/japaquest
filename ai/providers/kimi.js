const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "kimi",
  displayName: "Kimi (Moonshot AI)",
  notes: "Moonshot AI's Kimi models (K2/K3 family) through their OpenAI-compatible endpoint. Strong long-context and agentic performance.",
  baseURLEnv: "KIMI_BASE_URL",
  defaultBaseURL: "https://api.moonshot.ai/v1",
  apiKeyEnv: "KIMI_API_KEY",
  defaultModel: process.env.KIMI_DEFAULT_MODEL || "kimi-k2-0905-preview",
});
