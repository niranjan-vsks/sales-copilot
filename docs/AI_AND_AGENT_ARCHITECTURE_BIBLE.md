# AI & AGENT ARCHITECTURE BIBLE

> Everything about how AI works in Sales Copilot today, why it works that way, its failure modes, and the roadmap from "LLM intent parser" to a real agent platform.
> Companions: ARCHITECTURE §4 (data flow), SECURITY §6 (LLM threats), EXECUTION (tasks).

---

## 1. AI Surface Inventory

| Surface | Model | Entry point | Job |
|---|---|---|---|
| AI Chat | Groq `llama-3.1-8b-instant` | `POST /api/chat` → `ai_chat.py` | Natural language → structured action envelope (`log_activity`, `log_activity_sheet`, or plain chat) |
| Notes summarizer | same | `activity_sheet_processor.py` → `prompts/notes_summarizer.txt` | Informal meeting notes → professional CRM prose |
| Context snapshot | n/a (deterministic) | `knowledge_base.py` | Live app-state block injected into every chat system prompt |

Everything else labeled "AI" in the product is deterministic code (fuzzy matching, column detection, datetime parsing).

---

## 2. The Chat Pipeline (today)

```
user message
  └▶ /chat handler (server.py)
       ├─ history: last 10 chat_history turns
       ├─ context: knowledge_base.get_ai_context_snapshot()
       │     • D365 connection status (which fallback tier is live)
       │     • default account file name + account count
       │     • recent workflow executions (type, account, status)
       ├─ system prompt = prompts/ai_chat_system.txt  ⊕  context block
       ├─ Groq chat completion (temperature low, JSON envelope requested in prompt)
       ├─ envelope parse: {action, parameters, response}
       │     parse failure ⇒ treat whole output as plain chat text
       ├─ action dispatch:
       │     chat                → return response text
       │     log_activity        → account resolution → D365 fallback chain
       │     log_activity_sheet  → activity_sheet_processor pipeline
       └─ persist both turns; log knowledge-base event
```

### Design strengths
1. **Live-state prompt injection** (`knowledge_base.py`) is the genuinely differentiated idea: the model always knows whether D365 is connected, which account file is active, and what was recently logged — so its answers and confirmations reflect reality instead of hallucinating capability.
2. **Action envelope keeps the LLM out of the write path**: the model never calls D365; it emits a proposal that existing deterministic code executes. The right instinct — under-enforced (see §6).
3. **Sheet-paste detection in chat** collapses two features into one surface: a pasted table routes into the full activity-sheet pipeline with parsing, dedup, and notes summarization.

### Design weaknesses
1. **JSON by convention.** The envelope is requested in prose; there is no schema-constrained decoding. An 8B model will periodically emit malformed JSON, extra prose, or hallucinated parameters. Current failure mode is "fall back to chat text" — safe but silent.
2. **8B-instant is a speed/cost choice, not a quality choice.** Entity extraction (dates like "last Thursday after lunch", account names with typos) is exactly where small models are weakest.
3. **No confirmation step for writes.** A misparsed date or account can be logged to a customer's CRM without a "logging meeting with X on Y — confirm?" gate.
4. **Single provider, no fallback** (Risk R8). Groq outage = feature outage.
5. **History window is 10 turns with no summarization** — long sessions lose context abruptly.

---

## 3. Prompt Architecture

### `prompts/ai_chat_system.txt`
Defines: the copilot persona, the available actions and their parameter shapes, the JSON envelope contract, guidance on when to ask clarifying questions, and formatting rules. The live context block is appended at build time by `ai_chat.py`.

**Assessment**: monolithic prompt doing four jobs (persona, tool schema, policy, formatting) — each of which should eventually be a separately-versioned, separately-evaled artifact.

### `prompts/notes_summarizer.txt`
Converts rep shorthand ("met w/ CTO, likes prop, $$ concerns q3") into CRM-appropriate summaries. Runs per sheet row that has informal notes.

**Assessment**: good scoped prompt. Risks: cost/latency multiplies with sheet size (N rows = N LLM calls, serial); no guarantee it preserves facts (numbers, names) — needs a faithfulness eval.

### Prompt management gaps
- Prompts are loose text files with no version tags, no changelog, no eval suite. A prompt edit is an untested production deploy of business logic.
- **Target**: prompts as versioned artifacts (`prompt_id@version` logged with every completion), plus a small golden-set eval (§7) that runs in CI on any prompt change.

---

## 4. The Knowledge Base System (`knowledge_base.py`, `app_knowledge_base`)

Two halves:
1. **Event log**: append-only records of app events (executions, connection changes, uploads). Global scope today (needs `org_id`).
2. **`get_ai_context_snapshot()`**: composes the live-state block from `bot_config`, `uploaded_files`, `user_account_data` counts, and recent `workflow_executions`.

This is the seed of the long-term moat ("memory layer for sales teams" — PRODUCT §3), but today it is:
- **Shallow**: counts and statuses, not interaction content.
- **Global**: no tenant or user scoping in the event log.
- **Unbounded**: no retention or compaction policy.

**Evolution path**: event log → per-org interaction store → retrieval layer (semantic search over `activity_sheet_log` notes + executions) → the model can answer "when did we last meet Acme and what did we discuss?" That single query type transforms the product from logger to memory.

---

## 5. The Deterministic "AI-Adjacent" Layer

Worth documenting because it does the heavy lifting:

| Component | Technique | Notes |
|---|---|---|
| Column alias mapping (`activity_sheet_processor`) | ~40 hand-maintained aliases incl. Lenovo-specific ("Primary Lenovo Attendee", MDM IDG/ISG) | Works, but is customer-specific config hardcoded as code (TD-05). Target: per-org column-mapping config, LLM-assisted mapping suggestion on first upload. |
| Datetime parsing | Multi-format parser w/ fuzzy formats | Ambiguity (DD/MM vs MM/DD) unresolved — needs org-locale setting. |
| Account fuzzy matching (`excel_processor`) | Jaccard token similarity vs user account cache | Reasonable; no confidence surfacing to user on low-confidence matches in all paths. |
| Sheet dedup | `serial_no` unique per user in `activity_sheet_log` | Simple and effective; breaks if reps reuse serials across files — consider content hash. |

**Principle** (Master Index #2): keep this layer deterministic. Do not replace working parsers with LLM calls; use the LLM only where language understanding is genuinely required.

---

## 6. AI Security & Safety (with SECURITY §6)

Threats, restated as engineering requirements:

1. **Schema-validated actions (SEC-17).** Move to structured output (JSON schema / tool-calling if the provider supports it; otherwise strict Pydantic validation + reject-and-retry). Unknown action or unexpected parameter ⇒ refuse, never guess.
2. **Business-rule gate before side effects (SEC-16).** Server-side, post-LLM: account must exist in the user's cache, date within a sane window (e.g. ±90 days), row count caps for sheet actions, per-user daily write caps.
3. **Confirmation UX for writes.** Chat-initiated D365 writes above trivial confidence should round-trip a confirmation ("Log 45-min meeting with **Acme Corp** on **Mar 3**? [Confirm]"). This also fixes the misparse problem (§2 weakness 3).
4. **Data/instruction separation (SEC-19).** Pasted sheets and account names go into the prompt as fenced data blocks with an explicit "content, not instructions" framing; strip/escape anything that looks like prompt-injection payloads before inclusion.
5. **Egress policy (SEC-18).** Per-org toggle: which fields may be sent to the LLM (e.g. notes yes/no), and eventually provider choice (Groq / Azure OpenAI in-tenant for enterprise).

---

## 7. Evaluation & Observability (currently: none)

Minimum viable eval stack (EXECUTION TASK-008):
1. **Golden set** (~50 cases): chat messages → expected action envelopes; informal notes → summaries scored for faithfulness (all numbers/names preserved) and register.
2. **CI gate**: eval runs on any change to `prompts/`, `ai_chat.py`, or the model ID; regression beyond threshold blocks merge.
3. **Production telemetry**: log per completion — prompt version, model, latency, token counts, parse success, action taken, human-corrected? (when a user edits a proposed activity). Parse-failure rate is the canary metric.
4. **Feedback loop**: user edits to AI-proposed activities are labeled training/eval data. Capture them.

---

## 8. Model Strategy & Roadmap

**Today**: Groq `llama-3.1-8b-instant`, single provider, prompt-convention JSON.

**Near term (with Phase 0/1 of Master Index §6):**
- Provider abstraction with fallback (Groq → secondary provider) and model config per task (chat parsing vs notes summarization can use different models).
- Structured output enforcement (§6.1).
- Model upgrade path: evaluate a mid-size model for entity extraction; keep 8B for summarization if evals allow.

**Medium term (agent roadmap, PRODUCT §5–§8):**
1. **Tool-calling agent** replaces the single-envelope pattern: tools = `resolve_account`, `create_activity`, `search_history`, `parse_sheet`, each schema-validated, each with server-side guards. Multi-step: "log meetings with Acme and Globex" → two validated tool calls.
2. **Retrieval over interaction memory** (§4 evolution): the agent answers questions about past interactions before it drafts anything new.
3. **Proactive agent**: watches calendar (Graph) → "you met Acme at 2pm, want me to log it? here's a draft summary from the invite." This inverts the product from pull to push and is the retention feature.
4. **Draft-only email/follow-up agent**: generates follow-up drafts grounded in interaction memory; human always sends (side-effect policy stays: propose, never dispose).

**Standing rules for all of it:**
- Every LLM output is a proposal; deterministic validation owns side effects.
- Every prompt is versioned and evaled.
- Every completion is observable (cost, latency, outcome).
- No new AI surface ships without its golden-set slice.
