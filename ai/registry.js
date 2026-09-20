'use strict';
require('dotenv').config();

// Keys can live in .env OR in the admin panel (settings table). Check both.
function keyAvailable(envVar, settingKey) {
  if (envVar && process.env[envVar]) return true;
  try {
    const { Q } = require('../db');
    return !!Q.getSetting(settingKey);
  } catch { return false; }
}

const PROVIDERS = {
  claude:       { name:'Claude Sonnet 4',      tag:'Anthropic',   icon:'✨', free:false, configured:()=>keyAvailable('ANTHROPIC_API_KEY','ai_anthropic_key') },
  openai:       { name:'GPT-4o',               tag:'OpenAI',      icon:'🧠', free:false, configured:()=>keyAvailable('OPENAI_API_KEY','ai_openai_key') },
  deepseek:     { name:'DeepSeek R1',          tag:'OpenRouter',  icon:'🔍', free:true,  configured:()=>keyAvailable('OPENROUTER_API_KEY','ai_openrouter_key') },
  qwen:         { name:'Qwen 2.5 72B',         tag:'OpenRouter',  icon:'🔭', free:true,  configured:()=>keyAvailable('OPENROUTER_API_KEY','ai_openrouter_key') },
  llama:        { name:'Llama 3.3 70B',        tag:'OpenRouter',  icon:'🦙', free:true,  configured:()=>keyAvailable('OPENROUTER_API_KEY','ai_openrouter_key') },
  gemma:        { name:'Gemma 3 27B',          tag:'OpenRouter',  icon:'💎', free:true,  configured:()=>keyAvailable('OPENROUTER_API_KEY','ai_openrouter_key') },
  mistral:      { name:'Mistral 7B',           tag:'OpenRouter',  icon:'🌪️', free:true,  configured:()=>keyAvailable('OPENROUTER_API_KEY','ai_openrouter_key') },
  'llama-groq': { name:'Llama 70B (Groq)',     tag:'Groq',        icon:'⚡', free:true,  configured:()=>keyAvailable('GROQ_API_KEY','ai_groq_key') },
  'mixtral-groq':{ name:'Mixtral (Groq)',      tag:'Groq',        icon:'⚡', free:true,  configured:()=>keyAvailable('GROQ_API_KEY','ai_groq_key') },
  'gemini-flash':{ name:'Gemini 1.5 Flash',    tag:'Google',      icon:'🔮', free:true,  configured:()=>keyAvailable('GEMINI_API_KEY','ai_gemini_key') },
  'gemini-pro': { name:'Gemini 1.5 Pro',       tag:'Google',      icon:'🔮', free:false, configured:()=>keyAvailable('GEMINI_API_KEY','ai_gemini_key') },
  'llama-together':{ name:'Llama (Together)',  tag:'Together AI', icon:'🤝', free:true,  configured:()=>keyAvailable('TOGETHER_API_KEY','ai_together_key') },
  deepseek2:    { name:'DeepSeek Direct',      tag:'DeepSeek',    icon:'🔍', free:false, configured:()=>keyAvailable('DEEPSEEK_API_KEY','ai_deepseek_key') },
  mistral7b:    { name:'Mistral 7B Instruct',  tag:'HuggingFace', icon:'🤗', free:true,  configured:()=>keyAvailable('HUGGINGFACE_API_KEY','ai_huggingface_key') },
  zephyr:       { name:'Zephyr 7B Beta',       tag:'HuggingFace', icon:'🤗', free:true,  configured:()=>keyAvailable('HUGGINGFACE_API_KEY','ai_huggingface_key') },
  ollama:       { name:'Ollama (Local)',       tag:'Local',       icon:'🏠', free:true,  configured:()=>true },
};

function getModelMeta(id) { return PROVIDERS[id] || { name:id, tag:'Unknown', icon:'🤖', free:false, configured:()=>false }; }
function listAll() { return Object.entries(PROVIDERS).map(([id,m])=>({id,...m,isConfigured:m.configured()})); }
function listConfigured() { return listAll().filter(m=>m.isConfigured); }

module.exports = { getModelMeta, listAll, listConfigured };
