# Flow Build Guide — `loop.crm.v1` generic flow (build once)

Audience: Niranjan, building the flow by hand in Power Automate inside the Lenovo environment. About 30–45 minutes. After this, the flow is **never edited** for new fields, filters or activity types.

The flow runs as **you** (your Lenovo identity and MFA) using Microsoft's own connectors. It needs no admin consent.

Keep the **old flow switched on** until P2 is live in production. Do not delete it.

---

## Before you start
- You are signed in to https://make.powerautomate.com and the environment picker (top right) shows the environment where your D365 org lives.
- You know your D365 org URL, e.g. `https://<org>.crm.dynamics.com` (from the D365 browser address bar).
- Generate a long random secret for `LOOP_FLOW_KEY` (any password manager, 40+ characters, letters and digits only). Keep it in `docs/revamp/private/.env.probe` — never in git.

P0 user task U3 tells you which variant to build. **Variant A** is preferred.

---

## Variant A — Dataverse Web API via "HTTP with Microsoft Entra ID (preauthorized)"

### 1. Create the flow
Create → **Instant cloud flow** → name `Loop CRM Bridge v1` → Skip → add trigger **When an HTTP request is received** (Request connector).
- **Who can trigger the flow:** Anyone. (Protection comes from the secret URL + the `X-Loop-Key` check below.)
- **Request Body JSON Schema** — paste:
```json
{
  "type": "object",
  "properties": {
    "contract":   {"type": "string"},
    "request_id": {"type": "string"},
    "method":     {"type": "string"},
    "path":       {"type": "string"},
    "body":       {}
  },
  "required": ["contract", "request_id", "method", "path"]
}
```

### 2. Variables (add these right after the trigger, in this order)
| Action | Name | Type | Value |
|---|---|---|---|
| Initialize variable | `LoopKey` | String | your secret |
| Initialize variable | `AllowList` | Array | `["accounts","appointments","phonecalls","tasks","systemusers","EntityDefinitions","WhoAmI"]` |
| Initialize variable | `Status` | Integer | `0` |
| Initialize variable | `Result` | Object | `{}` |

### 3. Compose the entity name
Add **Compose**, rename to `Entity`, Inputs (expression):
```
first(split(first(split(triggerBody()?['path'], '?')), '('))
```

### 4. Guard condition
Add **Condition**. Switch to the advanced/expression editor and use:
```
@and(
  equals(coalesce(triggerOutputs()?['headers']?['X-Loop-Key'], triggerOutputs()?['headers']?['x-loop-key'], ''), variables('LoopKey')),
  contains(variables('AllowList'), outputs('Entity')),
  contains(createArray('GET','POST','PATCH'), triggerBody()?['method'])
)
```
**If no:** add **Response** — Status code `200`, Body:
```json
{"contract": "loop.crm.v1", "request_id": "@{triggerBody()?['request_id']}", "status_code": 401, "body": {"error": {"message": "rejected by guard"}}}
```
then **Terminate** (Status: Succeeded).

### 5. If yes → Switch on method
Add **Switch**, On = `triggerBody()?['method']`. Create three cases. In each case add **Invoke an HTTP request** (connector: *HTTP with Microsoft Entra ID (preauthorized)*). First time only, create the connection: **Base Resource URL** = your org URL, **Azure AD Resource URI** = your org URL, sign in with your Lenovo account.

| Case | Method | Url of the request | Headers | Body |
|---|---|---|---|---|
| `GET` (rename action `Invoke_GET`) | GET | `@{concat('/api/data/v9.2/', triggerBody()?['path'])}` | `Accept: application/json`, `OData-MaxVersion: 4.0`, `OData-Version: 4.0` | — |
| `POST` (`Invoke_POST`) | POST | same | above + `Content-Type: application/json`, `Prefer: return=representation` | `@{triggerBody()?['body']}` |
| `PATCH` (`Invoke_PATCH`) | PATCH | same | above + `Content-Type: application/json`, `If-Match: *` | `@{triggerBody()?['body']}` |

For each Invoke action: Settings → **Retry policy: None** (the backend retries).

After each Invoke action, add two **Set variable** actions. On each Set variable, open **Configure run after** and tick **is successful** AND **has failed** AND **has timed out**:
- `Status` = `outputs('Invoke_GET')?['statusCode']` (use the matching action name per case)
- `Result` = `coalesce(body('Invoke_GET'), json('{}'))`

### 6. Final response (after the Switch, outside it)
Add **Response**. Configure run after: **is successful** AND **has failed** AND **has timed out**. Status code `200`. Body:
```json
{
  "contract": "loop.crm.v1",
  "request_id": "@{triggerBody()?['request_id']}",
  "status_code": @{variables('Status')},
  "body": @{variables('Result')}
}
```

### 7. Save and test
- Save. Open the trigger card and copy the **HTTP URL**. It must be on `*.environment.api.powerplatform.com` (not `logic.azure.com`).
- Put it in `docs/revamp/private/.env.probe`:
```
LOOP_FLOW_URL=<copied URL>
LOOP_FLOW_KEY=<your secret>
```
- Ask the agent to run `python scripts/d365_probe.py whoami`. Expected: `status_code: 200` with your `UserId`. Check Run history in Power Automate: one successful run.
- Then `python scripts/d365_probe.py account --filter lvo_mdmid=<a real MDM ID>` → exactly one account.

### 8. If something fails
| Symptom | Fix |
|---|---|
| Probe gets HTTP 202 and no body | The final Response action is missing or not reached: check its run-after settings. |
| `status_code: 401` with "rejected by guard" | Header name or secret mismatch. |
| Invoke fails with 401/403 | The connection's Base Resource URL / Resource URI must be exactly your org URL (no trailing slash). |
| DLP error when saving | Variant A is blocked in your environment → build Variant B. |

---

## Variant B — Microsoft Dataverse connector (only if Variant A is DLP-blocked)

Same trigger, variables, `Entity` compose, guard and final Response as Variant A. Replace the Switch cases:
- **GET** → if `path` contains `(` → **Get a row by ID** (Table name: *Enter custom value* = `outputs('Entity')`, Row ID = the text between `(` and `)`); else **List rows** (Table name custom = `outputs('Entity')`, Filter rows = the `$filter` part of the path, Select columns = the `$select` part, Row count = the `$top` part). The agent gives you the exact split expressions in HANDOFF.md during P0.
- **POST** → **Add a new row** (Table name custom = `outputs('Entity')`). With a dynamic table name the action shows one JSON item field: set it to `triggerBody()?['body']`.
- **PATCH** → **Update a row** (Table name custom, Row ID from the path, item = `triggerBody()?['body']`).
- Set `Status` to `200`/`201`/`204` on success and to `400` on failure (with `Result` = the action's error body: `outputs('<action>')?['body']`).

P0 must confirm with a spike that dynamic-table JSON items and `@odata.bind` lookups work in Variant B before P2 relies on them.

---

## Rotating the key
Change `LoopKey` in the flow → save → update the key in Admin → Connections → CRM Connection (after P2) or `.env.probe` (P0). Calls fail with `FLOW_AUTH_REJECTED` until both match.
