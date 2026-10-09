# Loop Copilot Revamp — start here

Spec-driven, phase-wise rebuild of the CRM write path, model layer and MCP integration for Loop Copilot / Sales Copilot (www.loopcopilot.cc).

## Reading order for any agent
1. [DOCTRINE.md](DOCTRINE.md) — how to work: scope, safety, audit gates, git/deploy, state updates. **Binding.**
2. [STATE.md](STATE.md) — where we are. **Source of truth.**
3. [HANDOFF.md](HANDOFF.md) — what the last session did and the exact next step.
4. Your phase spec in [phases/](phases/).
5. [ARCHITECTURE.md](ARCHITECTURE.md) and [AUDIT.md](AUDIT.md) — sections your phase cites.

## Phases

| # | Name | One line |
|---|---|---|
| P0 | [Groundwork](phases/P0-groundwork.md) | Prove the root cause, build the test harness + fake flow + probe, build the generic flow once, capture tenant schema |
| P1 | [Truthful Logging](phases/P1-truthful-logging.md) | Fix every bug that hides failures or sends wrong data on today's flow; fix CORS PATCH and rate limits |
| P2 | [Universal Connector](phases/P2-universal-connector.md) | CRM connector layer + generic flow + field-map config: all activity types, config-only filters/fields, idempotent writes, read-back proof |
| P3 | [Model Layer](phases/P3-model-layer.md) | Provider-agnostic LLM layer: Groq default, Gemini on by adding a key, Groq fallback, schema-validated output |
| P4 | [MCP Bridge](phases/P4-mcp-bridge.md) | Tool-driven chat agent (MCP-shaped tools), Dataverse MCP connector for consenting tenants, Copilot Studio spike |
| P5 | [Restructure](phases/P5-restructure.md) | Split `server.py` into modules with zero behaviour change |
| P6 | [Hardening](phases/P6-hardening.md) | Security fixes, durable retry outbox, health alerts, structured logs, committed E2E suite |
| P7 | [CRM Expansion](phases/P7-crm-expansion.md) | Salesforce then HubSpot connectors (future; spec refresh first) |

## Dependency graph and parallel lanes

```
P0 ──► P1 ──► P2 ──┐
  └──► P3 ─────────┴─► P4 ──► P5 ──► P6 ──► P7
```
- Session A: P1 then P2. Session B: P3 (can start as soon as P0 is DONE), then P4 once P2 is DONE.
- P5 and later run alone.

## Go-words
The user starts a phase by typing **`BULLSEYE P<n>`**. Without it, agents only read and plan.

## Kickoff prompts
[KICKOFF.md](KICKOFF.md) — paste-ready prompts for new Claude / Codex sessions.

## Other docs
- [FLOW_BUILD_GUIDE.md](FLOW_BUILD_GUIDE.md) — the user builds the generic Power Automate flow once (P0).
- `private/` — git-ignored tenant evidence, schema and field map (created in P0).
