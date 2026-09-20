const { makeOpenAICompatibleProvider } = require("../openaiCompatible");

module.exports = makeOpenAICompatibleProvider({
  key: "huggingface",
  displayName: "Hugging Face",
  notes: "Uses Hugging Face's Inference Providers router, which is OpenAI-compatible. defaultModel must be a real model id available through that router (e.g. 'meta-llama/Llama-3.1-8B-Instruct') — set HUGGINGFACE_DEFAULT_MODEL to whichever model you actually want.",
  baseURLEnv: "HUGGINGFACE_BASE_URL",
  defaultBaseURL: "https://router.huggingface.co/v1",
  apiKeyEnv: "HUGGINGFACE_API_KEY",
  defaultModel: process.env.HUGGINGFACE_DEFAULT_MODEL || "meta-llama/Llama-3.1-8B-Instruct",
});
