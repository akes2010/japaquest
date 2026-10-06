const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "omniroute",
  displayName: "OmniRoute (free gateway)",
  notes: "Free, open-source AI gateway pooling 90+ free-tier providers behind one OpenAI-compatible endpoint. Self-host it (localhost:20128/v1) or use the hosted gateway. A 'free' model id routes across its free pool automatically.",
  baseURLEnv: "OMNIROUTE_BASE_URL",
  defaultBaseURL: "https://omniroute.online/v1",
  apiKeyEnv: "OMNIROUTE_API_KEY",
  apiKeyRequired: false, // hosted gateway is keyless for free models; self-host may set one
  defaultModel: process.env.OMNIROUTE_DEFAULT_MODEL || "auto",
});
