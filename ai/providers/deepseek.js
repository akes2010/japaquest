const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "deepseek",
  displayName: "DeepSeek",
  notes: "DeepSeek's own OpenAI-compatible API. Strong price/performance, especially for reasoning-heavy prompts.",
  baseURLEnv: "DEEPSEEK_BASE_URL",
  defaultBaseURL: "https://api.deepseek.com/v1",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  defaultModel: process.env.DEEPSEEK_DEFAULT_MODEL || "deepseek-chat",
});
