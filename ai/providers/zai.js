const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "zai",
  displayName: "z.ai (GLM)",
  notes: "Z.ai's OpenAI-compatible API for the GLM model family (GLM-4.6/4.7/5.x). Top open-source model line, strong reasoning and coding.",
  baseURLEnv: "ZAI_BASE_URL",
  defaultBaseURL: "https://api.z.ai/api/paas/v4",
  apiKeyEnv: "ZAI_API_KEY",
  defaultModel: process.env.ZAI_DEFAULT_MODEL || "glm-4.6",
});
