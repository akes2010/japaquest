# AI Agents Guide — free & open model rotation, orchestration, /v1 gateway

JapaQuest runs a **continuously rotating free model pool** ("♾️ Auto"), a
**multi-phase model-handoff orchestrator**, and an **OpenAI-compatible `/v1`
gateway** any agent tool can consume. This guide is the operator's map.

---

## 1. The free pool (live-verified)

Pick ♾️ **Auto** as the model and the system rotates providers per request:
rotating start offset, cooldowns on failure/rate-limits, upstream-group
skipping, and a walk until someone answers (`utils/ai-rotation.js`).

| Pool | ids | Notes |
|---|---|---|
| Self-hosted engine | `llama-local` `qwen-local` `deepseek-local` | Ollama / vLLM / LM Studio / `AI_BASE_URL` — serves **Llama 3.3 70B, Qwen 2.5 7/14/72B, Qwen2.5-Coder, Mistral Nemo & Large, DeepSeek R1/V3, Phi-4** (any tags you `ollama pull`; missing tags are skipped) |
| xKiro | `xkiro` `qwen3max` `qwen3coder` `mistral-xk` | ~500K free tokens/day, `:free` ids + Mistral Large |
| Groq | `qwen3-groq` `llama-groq` `mixtral-groq` `allam-groq` | Qwen 3.8 27B, GPT-OSS 120B/20B, Allam 7B — free tier. *(`llama-groq`/`mixtral-groq` ids kept for plan/DB compat; Groq decommissioned llama-3.3-70b + mixtral-8x7b upstream.)* |
| OpenRouter free | `or-free` `north-code` `laguna` `flint` `gemma4` | Free Model Router (`openrouter/free`), coding agents (North Mini Code, Laguna), Gemma 4 31B |
| Google | `gemini-flash` | free tier |
| Cloudflare | `cloudflare` | Workers AI free daily quota (needs account id + token) |
| HuggingFace | `mistral7b` | free inference tier |
| OmniRoute | `omniroute` | self-hosted gateway (`npx omniroute` → 90+ free models) |
| Flowise | `flowise` | your own agent flow (see §5) |

**Legacy OpenRouter slots** `deepseek` `qwen` `llama` `gemma` `mistral` +
`phi4` moved to the **premium** pools: upstream retired their `:free` twins,
so they now serve live **paid** ids — DeepSeek-**V3**, Qwen 2.5 72B,
Llama 3.3 70B, Gemma 3 27B, Mistral **Nemo** 12B, Phi-4 — and bill the
operator's OpenRouter balance, never the free rotation.

> Every id above was probed live (real chat completion, real content) before
> being wired in. Ids that 404'd upstream were removed or re-pointed.

## 2. Multi-phase orchestration — `POST /api/ai/orchestrate`

The model-handoff pattern: **one shared `taskMemory` thread** flows through a
chain of models, each phase continuing exactly where the previous one stopped.

```bash
TOKEN=$(curl -s -X POST http://localhost:4001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -s -X POST http://localhost:4001/api/ai/orchestrate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "system": "You are a system orchestrator agent.",
    "prompt": "Analyze this server log and fix any database errors found.",
    "phases": [
      { "name": "plan",    "model": "deepseek-r1",      "prompt": "Phase 1: Create a step-by-step resolution plan." },
      { "name": "execute", "model": "qwen2.5-coder:7b", "prompt": "Phase 2: Based on that plan, write the Node.js script." }
    ]
  }'
```

`system` is optional (max 4 000 chars): omit it and the workflow runs under
the app's standard travel-assistant prompt; set it for ops/orchestrator
personas exactly like your snippet.

Response: `{ success, phases:[{phase, requestedModel, servedBy, output}],
final, planCreatedBy, executedBy, taskMemoryMessages }`.

**Phase model resolution (in order):**
1. **exact engine tag** (`deepseek-r1`, `phi4`, `qwen2.5-coder:7b`, …) — served by
   `AI_BASE_URL` / Ollama / vLLM / LM Studio; variant tags match (`deepseek-r1` → `deepseek-r1:8b`)
2. **family id** (`qwen-local`, …) — engine first, then that family's cloud fallbacks
3. **registry id** (`deepseek`, `qwen3coder`, `laguna`, `flowise`, …)
4. **♾️ rotation always closes the phase** — a dead provider never stops a workflow

Defaults (no `phases` in the body): plan with `deepseek-r1`, execute with
`qwen2.5-coder:7b` — override per call, or per box with
`ORCH_PLAN_MODEL` / `ORCH_EXECUTE_MODEL` / `ORCH_PHASE_TIMEOUT_MS` (`.env`).

## 3. `/v1` — OpenAI-compatible gateway (Qoder, Kiro, arena, LangChain…)

Any OpenAI-SDK client can use this system as its model backend:

```bash
curl -s http://localhost:4001/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
# → standard OpenAI chat.completion JSON
```

* **base_url** = `https://yourdomain.com/v1`, **api_key** = a JWT from
  `/api/auth/login` (Bearer), **model** = `auto` (infinite free rotation) or
  any id from `GET /v1/models`.
* **Qoder** and **Kiro** are IDE agents, not APIs — but both accept a custom
  *OpenAI-compatible* model endpoint (Qoder desktop: Settings → Models →
  OpenAI Compatible). Point them at `/v1` and they ride the free pool.
* **arena.ai (LMArena)**: run the open-source
  [LMArenaBridge](https://github.com/CloudWaddie/LMArenaBridge) locally and
  point its upstream at `/v1` (or add LMArena itself as a provider behind it).
* LangChain / n8n / OpenWebUI / Cherry Studio: `openai` client with the
  base_url above.

## 4. Dynamic engine base — `AI_BASE_URL` + ngrok

One env var moves the entire engine to any OpenAI-compatible `/v1` server;
it is probed **before** the built-in runtimes:

```bash
# local Ollama
AI_BASE_URL=http://localhost:11434/v1
# home GPU exposed to shared hosting through a free ngrok tunnel
#   (on the GPU box: ngrok http 11434  →  copy the https://…ngrok-free.app URL)
AI_BASE_URL=https://xxxx.ngrok-free.app/v1
# optional if the server needs auth (Ollama ignores it)
AI_BASE_KEY=
```

The engine auto-detects which model tags that server actually serves, so the
`llama3.3 / qwen2.5:7b / mistral-nemo / deepseek-r1 / phi4` family is live
the moment you `ollama pull` it.

## 5. Flowise agent flows

[Flowise](https://flowiseai.com) (open source, self-hosted) runs as a
provider via its documented prediction API:

```bash
npx flowise start        # build a chatflow in the UI, copy its id from the URL
FLOWISE_BASE_URL=http://localhost:3000
FLOWISE_CHATFLOW_ID=<chatflow id>
FLOWISE_API_KEY=         # only if the instance requires auth
```

Then pick the `flowise` model id (or let rotation reach it) — the flow owns
its own prompt/tools; the traveller's question is forwarded to it.

## 6. Adding more free providers

New OpenAI-compatible gateways follow one pattern (see `ai/providers/` +
`routes/ai.js` dispatch + `utils/ai-rotation.js` pool): register the id in
`ai/registry.js`, add its upstream model id(s) to the dispatch maps, add it
to `FREE_POOL`/`PREMIUM_EXTRA` and an `UPSTREAM_GROUPS` entry, then
**probe the model id live before shipping** — free catalogues churn weekly
(this guide's pool was rebuilt 2026-10 after upstream retirements).
