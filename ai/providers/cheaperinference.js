const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "cheaperinference",
  displayName: "Cheaper Inference",
  notes: "Multi-model gateway (ChatGPT, Claude, Gemini, DeepSeek…) at 15–60% below list price, OpenAI-compatible at https://api.cheaperinference.com/v1. Platform/dashboard: platform.cheaperinference.com — keys look like ci_live_… and every response carries an exact settled charge. Pay-as-you-go wallet (fund from $5); no free tier, so it sits in the premium pools, not the free rotation.",
  baseURLEnv: "CHEAPERINFERENCE_BASE_URL",
  defaultBaseURL: "https://api.cheaperinference.com/v1",
  apiKeyEnv: "CHEAPERINFERENCE_API_KEY",
  defaultModel: process.env.CHEAPERINFERENCE_DEFAULT_MODEL || "gemini-3.7-flash",
});
