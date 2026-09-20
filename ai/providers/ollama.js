const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "ollama",
  displayName: "Ollama (self-hosted)",
  notes: "Self-hosted, so there's no cloud API key — instead OLLAMA_BASE_URL must be explicitly set to wherever your Ollama instance actually runs (e.g. http://ollama:11434/v1 as a docker-compose service, or http://localhost:11434/v1). Deliberately not defaulted to localhost silently, since that would be misleading once this is running on a real server rather than a dev machine.",
  baseURLEnv: "OLLAMA_BASE_URL",
  defaultBaseURL: "http://localhost:11434/v1",
  requireExplicitBaseURL: true,
  apiKeyEnv: "OLLAMA_API_KEY", // most Ollama setups don't use one; set it only if yours is behind an auth proxy
  apiKeyRequired: false,
  defaultModel: process.env.OLLAMA_DEFAULT_MODEL || "llama3.1",
});
