# P4 — MCP Bridge

**Goal:** make the agent tool-driven and MCP-ready without weakening the deterministic write path.
1. **Agent tools:** the chat agent works through typed tools (search accounts, log activity, check status, recent activity) instead of one free-form JSON blob. Tools follow the MCP tool shape (name, description, JSON-schema input), so the same registry can later be served over MCP.
2. **Dataverse MCP connector:** a `CRMConnector` that talks to a tenant's Dataverse MCP server, for customers whose tenant grants consent. Switched on by config only.
3. **Copilot Studio spike (Lenovo, optional):** a time-boxed go/no-go on reaching Dataverse MCP from inside Lenovo's tenant via a Copilot Studio agent, with no IT involvement.

**Recommended model:** Opus 5.5 for T1–T3 design decisions; Sonnet 5.5 can implement from this spec.
**Dependencies:** P2 DONE, P3 DONE.
**Parallel-safe with:** nothing that touches `server.py` chat route or `crm/`.
**Branch:** `revamp/p4-mcp-bridge`

---

## Files

| File | Action |
|---|---|
| `backend/agent/__init__.py`, `tools.py`, `loop.py` | create |
| `backend/ai_chat.py` | route tool-capable providers through `agent.loop` |
| `backend/llm/gemini_provider.py`, `groq_provider.py`, `base.py`, `router.py` | add optional `tools` support |
| `backend/knowledge_base.py` | add `enabled_activity_types` to the snapshot |
| `backend/crm/connectors/dataverse_mcp.py` | create |
| `backend/crm/registry.py` | register `dataverse_mcp` type |
| `backend/server.py` | chat route: handle the agent loop result shape (see T1); nothing else |
| `frontend/src/pages/ChatPage.js` | render tool-step summaries ("Searched accounts", "Logged appointment — confirmed") |
| `frontend/src/pages/admin/ConnectionsPage.js` | add "Dataverse MCP" option to the connection type select |
| `tests/backend/test_p4_*.py` | create |

## Dependencies (pre-approved)
`mcp>=1.2` (official Model Context Protocol Python SDK) — only imported inside `dataverse_mcp.py`.

---

## Tasks

### P4.T1 — Tool registry (`agent/tools.py`)
```python
class Tool(BaseModel):
    name: str; description: str; input_schema: dict    # JSON Schema (MCP-compatible)
    handler: Callable[[ToolContext, dict], Awaitable[dict]]
    mutates: bool = False
```
Tools (all scoped to the calling user):
- `search_accounts(query: str, limit: int = 5)` → default-file accounts using `account_match.resolve` + search (name, IDG, ISG).
- `get_form_config()` → enabled activity types + custom params (from the field map).
- `log_activity(activity_type, subject, account_name, mdm_id?, start_time?, duration_minutes?, notes?, location?, custom?)` → **mutating**. Creates a `workflow_executions` doc and calls `crm.service.log_activity`. Returns `WriteResult`.
- `check_activity(execution_id)` → status + record URL; triggers recheck if `unverified`.
- `recent_activity(limit: int = 5)` → the user's latest executions.
- `start_activity_sheet(rows: list[...])` → **mutating**; same as the existing chat activity_sheet branch.

### P4.T2 — Agent loop (`agent/loop.py`)
- `run_agent(user, message, history, context) -> AgentResult` with max **6** tool steps and a 45s overall budget.
- Provider with native tool calling (Gemini function calling; Groq tool calls if the configured model supports them) → native loop. Otherwise → JSON-mode fallback: P3's `ChatDecision` path, unchanged.
- **Mutating-tool guard:** a mutating tool runs only if, in the same turn, the user's message clearly requests the action **and** all required fields are present after validation. If the account resolution is `ambiguous`/`none`, the agent must ask the user, not guess. At most **one** mutating call per user turn, except `start_activity_sheet`.
- `AgentResult` = `{user_message, steps: [{tool, ok, summary}], workflow_triggered, workflow_result}`. The chat route stores and returns these keys plus all existing keys (backward compatible for ChatPage).

### P4.T3 — Dataverse MCP connector (`crm/connectors/dataverse_mcp.py`)
- Config in `crm_connections`: `type: "dataverse_mcp"`, `mcp_url` (`https://<org>.crm.dynamics.com/api/mcp`), and the Entra app details for a **consenting** tenant (`tenant_id`, `client_id`, client secret encrypted). Token: MSAL client-credentials or the user's delegated token, scope `<org>/.default`.
- Use the `mcp` SDK streamable-HTTP client. On connect, call `list_tools` and map by name to the four connector operations. **Discover tool names at runtime; do not hard-code them.** Keep a config override `tool_map: {"create": "<name>", "read": "<name>", "update": "<name>", "query": "<name>"}`. If a required op has no tool, `health()` returns ok=false with the missing ops listed.
- The service layer stays the same: field map, idempotent id, completion, read-back. If the MCP create tool cannot accept a client-supplied primary key, record `idempotency: "best_effort"` in health detail and query for an existing record with the same `subject` + `regardingobjectid` + `scheduledstart` before retrying.
- Tests: an in-process fake MCP server (the SDK's server helpers) exposing tools with Dataverse-like semantics; same test matrix as P2's service tests.
- Lenovo stays on `dataverse_flow`. This connector is for future tenants and portfolio demos (e.g. a personal Dataverse developer environment where you are the admin and can consent — set up only if the user provides one).

### P4.T4 — Copilot Studio spike (time-box: 1 session; output is a decision, not production code)
Question: can the generic flow call a Copilot Studio agent (inside Lenovo's tenant, Dataverse MCP enabled by default there) to do **read-only intelligent operations** (schema discovery, fuzzy account search in D365) without any admin action?
Steps for the user (agent writes the checklist in HANDOFF.md): does copilotstudio.microsoft.com open for you in the Lenovo environment? Can you create an agent and add the Dataverse MCP tool? Can a flow run "Execute agent and wait"? Licence/message-capacity prompts?
Outcome recorded in STATE.md Decisions: `GO` (spec a follow-up phase P4b), or `NO-GO` with the reason. **Writes always stay on the deterministic flow path in either case.**

### P4.T5 — Snapshot
`knowledge_base.get_app_context_snapshot` adds `enabled_activity_types` (from `crm_field_maps`, fallback `["appointment"]`) and `crm_connection: {type, healthy, last_checked}`; `_build_live_state` in `ai_chat.py` prints them; never include URLs or keys.

---

## Click paths (G4)
1. Chat: "find accounts like neuland" → step "Searched accounts", list shown, no write.
2. Chat: "log a call with <exact account> today 4pm, 20 min, discussed renewal" → one `log_activity` step → confirmed (fake flow).
3. Chat with an ambiguous account → the agent asks which one; no write.
4. Chat: "did my last activity go through?" → `check_activity`.
5. Admin → Connections → type Dataverse MCP → fake MCP server URL → Test → ok; Dashboard log → confirmed via MCP connector.
6. Groq-only environment (no Gemini key) → JSON fallback path still works.

## Definition of done
- [ ] Tasks ticked; G1–G7 green; spike decision recorded
- [ ] No mutating tool can run without user intent and validated input (tests prove it)
- [ ] STATE.md, HANDOFF.md updated; P4 DONE
