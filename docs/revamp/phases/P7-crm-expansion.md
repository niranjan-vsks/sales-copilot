# P7 — CRM Expansion (Salesforce, then HubSpot)

**Status:** future. Do not start until the user says `BULLSEYE P7`. Before building, an Opus session refreshes this spec with current Salesforce/HubSpot API and MCP facts (they change often) and the user's target customer tenant.

**Goal:** add Salesforce and HubSpot as `CRMConnector` implementations so the chat agent, Dashboard, sheets and rules work unchanged on those CRMs.

**Recommended model:** Opus 5.5 to refresh the spec; Sonnet 5.5 to build.
**Dependencies:** P6 DONE.
**Branch:** `revamp/p7a-salesforce`, then `revamp/p7b-hubspot`.

---

## Design (fixed by the architecture)
- Connectors: `crm/connectors/salesforce.py`, `crm/connectors/hubspot.py`. Each implements `health`, `find_account`, `create`, `get`, `update` (ARCHITECTURE §3).
- Field maps: the same `crm_field_maps` shape. `entity_set` holds the CRM object name (`Event`, `Task` for Salesforce; `meetings`, `calls`, `tasks` for HubSpot); `regarding_nav` becomes the association field (`WhatId` for Salesforce; HubSpot uses association calls — the connector handles it after create).
- Account lookup filters map to SOQL `WHERE` (Salesforce, values escaped) or HubSpot CRM search filters.
- Idempotency: Salesforce → an External ID custom field (e.g. `Loop_Request_Id__c`) with upsert; HubSpot → a custom property `loop_request_id` + search-before-retry. The spec refresh must confirm both.
- Auth: OAuth per connection (Salesforce Connected App / External Client App, HubSpot public or private app). Tokens encrypted with Fernet in `crm_connections`; refresh handled inside the connector.
- MCP option: if the vendor's official MCP server exposes create/read/update/query for these objects, add `salesforce_mcp`/`hubspot_mcp` connector types that reuse P4's MCP adapter pattern (runtime tool discovery + `tool_map`).
- UI: the Connections page type select gains Salesforce and HubSpot (currently "Soon" placeholders), with OAuth connect buttons.

## Tasks (outline — the spec refresh expands each into P2-level detail)
- P7a.T1 Salesforce OAuth connect + token storage + health
- P7a.T2 Account lookup (SOQL) + field map for Event/Task
- P7a.T3 Create/read/update with External-ID idempotency; completion semantics
- P7a.T4 Tests against a fake Salesforce REST server; canary in a Salesforce developer org
- P7b.T1–T4 Same for HubSpot (meetings/calls/tasks + associations)

## Definition of done
Same as P2 for each CRM: every activity type confirmed by read-back, config-only filters and fields, idempotent retries, full gates, canary in a sandbox org.
