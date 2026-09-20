const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "openai",
  displayName: "OpenAI",
  notes: "Standard OpenAI Chat Completions API. Reliable global default.",
  baseURLEnv: "OPENAI_BASE_URL",
  defaultBaseURL: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  defaultModel: process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini",
});
