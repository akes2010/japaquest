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

// Self-hosted AI Engine models — always listed as configured; routes/ai.js
// shows them with the engine's actual online/offline state so users know
// whether a reply will come from their own box or a cloud fallback.
const LOCAL_META = {
  'llama-local':    { name: 'Llama (Self-hosted Engine)',   tag: 'Local Engine', icon: '🦙', free: true },
  'qwen-local':     { name: 'Qwen (Self-hosted Engine)',    tag: 'Local Engine', icon: '🧠', free: true },
  'deepseek-local': { name: 'DeepSeek R1 (Self-hosted Engine)', tag: 'Local Engine', icon: '🔍', free: true },
  'gemma-local':    { name: 'Gemma (Self-hosted Engine)',   tag: 'Local Engine', icon: '💎', free: true },
  'mistral-local':  { name: 'Mistral (Self-hosted Engine)', tag: 'Local Engine', icon: '🌪️', free: true },
};

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
  auto:         { name:'♾️ Auto — never stops',  tag:'Rotation',    icon:'♾️', free:true,  configured:()=>true },
  kimi:         { name:'Kimi K2',              tag:'Moonshot AI', icon:'🌙', free:false, configured:()=>keyAvailable('KIMI_API_KEY','ai_kimi_key') },
  zai:          { name:'GLM-4.6',              tag:'z.ai',        icon:'🧬', free:false, configured:()=>keyAvailable('ZAI_API_KEY','ai_zai_key') },
  omniroute:    { name:'OmniRoute (free)',     tag:'Free Gateway',icon:'🕸️', free:true,  configured:()=>keyAvailable('OMNIROUTE_API_KEY','ai_omniroute_key')||!!process.env.OMNIROUTE_BASE_URL },
  xkiro:        { name:'xKiro',                tag:'Free Tier',   icon:'🜲', free:true,  configured:()=>keyAvailable('XKIRO_API_KEY','ai_xkiro_key') },
  cloudflare:   { name:'Workers AI',           tag:'Cloudflare',  icon:'☁️', free:true,  configured:()=>!!(process.env.CLOUDFLARE_ACCOUNT_ID&&process.env.CLOUDFLARE_API_TOKEN) },
  ...Object.fromEntries(Object.entries(LOCAL_META).map(([id, m]) => [id, { ...m, configured:()=>true }])),
};

function getModelMeta(id) { return PROVIDERS[id] || LOCAL_META[id] || { name:id, tag:'Unknown', icon:'🤖', free:false, configured:()=>false }; }
function listAll() {
  return Object.entries(PROVIDERS).map(([id,m])=>({id,...m,isConfigured:m.configured()}));
}
function listConfigured() { return listAll().filter(m=>m.isConfigured); }
function isLocalModel(id) { return !!LOCAL_META[id]; }

module.exports = { getModelMeta, listAll, listConfigured, isLocalModel, LOCAL_META };
