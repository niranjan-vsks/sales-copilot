"""Fake Power Automate flow + Dataverse, for local runs and tests. Never touches a real tenant.

Run:  python -m uvicorn tests.fakes.fake_flow:app --port 8765

Endpoints
- POST /legacy   today's webhook payload. Mode from header X-Fake-Mode or env FAKE_FLOW_MODE:
                 ok (default) | no_id | error | slow
- POST /v1       `loop.crm.v1` envelope (docs/revamp/ARCHITECTURE.md §4). Always HTTP 200 with
                 {contract, request_id, status_code, body}; Dataverse-like errors in `body`.
- GET  /_records dump of the in-memory store.

Env: FAKE_FLOW_KEY (default "test-key"), FAKE_FLOW_SEED (JSON list of account dicts, or
{"accounts": [...]}) — default seeds two accounts with lvo_mdmid "1001" and "1002".
"""
import asyncio
import json
import os
import re
import uuid
from typing import Any, Dict, Optional, Tuple
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

CONTRACT = "loop.crm.v1"
SLOW_SECONDS = 35
ALLOWED_METHODS = {"GET", "POST", "PATCH"}
ALLOW_LIST = {"accounts", "appointments", "phonecalls", "tasks", "systemusers", "EntityDefinitions", "WhoAmI"}
TABLES = ("accounts", "appointments", "phonecalls", "tasks", "systemusers")
PRIMARY_KEY = {"accounts": "accountid", "systemusers": "systemuserid"}  # activities use activityid
# statecode -> allowed statuscodes (Dataverse defaults)
STATUS_PAIRS = {
    "appointments": {0: {1, 2}, 1: {3}, 2: {4}, 3: {5, 6}},
    "phonecalls": {0: {1}, 1: {2, 4}, 2: {3}},
    "tasks": {0: {2, 3, 4, 7}, 1: {5}, 2: {6}},
}
WHOAMI = {
    "BusinessUnitId": "00000000-0000-0000-0000-0000000000b1",
    "UserId": "00000000-0000-0000-0000-0000000000a1",
    "OrganizationId": "00000000-0000-0000-0000-0000000000c1",
}

app = FastAPI(title="Fake Loop CRM flow")
STORE: Dict[str, Any] = {}


def _default_seed() -> list:
    return [
        {"accountid": str(uuid.uuid4()), "name": "Fake Account One", "lvo_mdmid": "1001"},
        {"accountid": str(uuid.uuid4()), "name": "Fake Account Two", "lvo_mdmid": "1002"},
    ]


def reset() -> None:
    """Reset the store to its seeded state (tests call this between cases)."""
    raw = os.environ.get("FAKE_FLOW_SEED")
    seed = json.loads(raw) if raw else _default_seed()
    if isinstance(seed, dict):
        seed = seed.get("accounts", [])
    STORE.clear()
    STORE.update({t: {} for t in TABLES})
    STORE["legacy"] = []
    for acc in seed:
        acc = dict(acc)
        acc.setdefault("accountid", str(uuid.uuid4()))
        STORE["accounts"][acc["accountid"]] = acc


reset()


def _pk(table: str) -> str:
    return PRIMARY_KEY.get(table, "activityid")


def _err(status: int, code: str, message: str) -> Tuple[int, Dict[str, Any]]:
    return status, {"error": {"code": code, "message": message}}


# ── Legacy webhook ────────────────────────────────────────────────────────────

@app.post("/legacy")
async def legacy(request: Request):
    mode = request.headers.get("X-Fake-Mode") or os.environ.get("FAKE_FLOW_MODE", "ok")
    try:
        payload = await request.json()
    except ValueError:
        payload = {}
    if mode == "no_id":
        return Response(status_code=202)
    if mode == "error":
        return JSONResponse(status_code=500, content={"error": {"code": "FakeFlowError", "message": "flow failed"}})
    if mode == "slow":
        await asyncio.sleep(SLOW_SECONDS)
    activity_id = str(uuid.uuid4())
    STORE["legacy"].append({"activityid": activity_id, "payload": payload})
    return {"activityid": activity_id, "status": "success"}


# ── loop.crm.v1 ───────────────────────────────────────────────────────────────

_ENTITY_RE = re.compile(r"^(?P<set>[A-Za-z]+)(?:\((?P<key>[^)]*)\))?(?P<rest>/.*)?$")
_CLAUSE_RE = re.compile(r"^\s*(?P<field>[\w.]+)\s+eq\s+(?:'(?P<str>(?:[^']|'')*)'|(?P<bare>\S+))\s*$")


def _split_path(path: str) -> Tuple[str, Optional[str], str, Dict[str, str]]:
    resource, _, query = path.partition("?")
    m = _ENTITY_RE.match(resource)
    if not m:
        raise ValueError(f"Unparseable path: {resource}")
    params: Dict[str, str] = {}
    for part in filter(None, query.split("&")):
        k, _, v = part.partition("=")
        params[unquote(k)] = unquote(v)
    return m.group("set"), m.group("key"), m.group("rest") or "", params


def _parse_filter(expr: str) -> list:
    clauses = []
    for clause in re.split(r"\s+and\s+", expr.strip()):
        m = _CLAUSE_RE.match(clause)
        if not m:
            raise ValueError(f"Unsupported $filter clause: {clause}")
        if m.group("str") is not None:
            value: Any = m.group("str").replace("''", "'")
        else:
            bare = m.group("bare")
            value = {"true": True, "false": False, "null": None}.get(bare, bare)
        clauses.append((m.group("field"), value))
    return clauses


def _project(record: dict, select: Optional[str]) -> dict:
    out = {"@odata.etag": 'W/"1"'}
    if not select:
        out.update(record)
        return out
    for field in select.split(","):
        field = field.strip()
        if field in record:
            out[field] = record[field]
    return out


def _check_status_pair(table: str, record: dict) -> Optional[Tuple[int, dict]]:
    pairs = STATUS_PAIRS.get(table)
    if not pairs or "statuscode" not in record:
        return None
    state = record.get("statecode", 0)
    if record["statuscode"] not in pairs.get(state, set()):
        return _err(400, "0x80040203",
                    f"{record['statuscode']} is not a valid status code for state code "
                    f"{table[:-1].capitalize()}State.{state}")
    return None


def _resolve_binds(body: dict) -> Tuple[dict, Optional[Tuple[int, dict]]]:
    out = {}
    for key, value in body.items():
        if not key.endswith("@odata.bind"):
            out[key] = value
            continue
        nav = key[: -len("@odata.bind")]
        m = _ENTITY_RE.match(str(value).lstrip("/"))
        if not m or m.group("set") not in STORE or not m.group("key"):
            return out, _err(400, "0x80060888", f"Invalid @odata.bind value for {nav}: {value}")
        if m.group("key") not in STORE[m.group("set")]:
            return out, _err(400, "0x80040217", f"{m.group('set')} With Id = {m.group('key')} Does Not Exist")
        out[nav + "@odata.bind"] = value
        out["_regardingobjectid_value" if nav.startswith("regardingobjectid") else f"_{nav}_value"] = m.group("key")
    return out, None


def _dispatch(method: str, path: str, body: Any) -> Tuple[int, Any]:
    try:
        table, key, rest, params = _split_path(path)
    except ValueError as e:
        return _err(400, "0x80060888", str(e))

    if table == "WhoAmI":
        return (200, dict(WHOAMI)) if method == "GET" else _err(405, "0x80060888", "WhoAmI is GET only")

    if table == "EntityDefinitions":
        if method != "GET":
            return _err(405, "0x80060888", "EntityDefinitions is read-only")
        logical = (key or "").split("=", 1)[-1].strip("'")
        if rest.startswith("/Attributes"):
            return 200, {"value": [
                {"LogicalName": "subject", "AttributeType": "String", "RequiredLevel": {"Value": "ApplicationRequired"}},
                {"LogicalName": "scheduledend", "AttributeType": "DateTime", "RequiredLevel": {"Value": "None"}},
                {"LogicalName": "lvo_mdmid", "AttributeType": "String", "RequiredLevel": {"Value": "None"}},
            ]}
        if rest.startswith("/ManyToOneRelationships"):
            return 200, {"value": [{"ReferencingEntityNavigationPropertyName": f"regardingobjectid_account_{logical}",
                                    "ReferencedEntity": "account"}]}
        return 200, {"LogicalName": logical, "EntitySetName": logical + "s"}

    rows = STORE[table]
    pk = _pk(table)

    if method == "GET" and key is None:
        try:
            clauses = _parse_filter(params["$filter"]) if params.get("$filter") else []
            top = int(params["$top"]) if params.get("$top") else None
        except ValueError as e:
            return _err(400, "0x80060888", str(e))
        matched = [r for r in rows.values() if all(r.get(f) == v for f, v in clauses)]
        if top is not None:
            matched = matched[:top]
        return 200, {"@odata.context": f"fake/$metadata#{table}", "value": [_project(r, params.get("$select")) for r in matched]}

    if method == "GET":
        if key not in rows:
            return _err(404, "0x80040217", f"{table[:-1]} With Id = {key} Does Not Exist")
        return 200, _project(rows[key], params.get("$select"))

    if not isinstance(body, dict):
        return _err(400, "0x80040203", "Request body must be a JSON object")

    if method == "POST":
        if key is not None:
            return _err(405, "0x80060888", "POST must target an entity set")
        record, bind_err = _resolve_binds(body)
        if bind_err:
            return bind_err
        record.setdefault(pk, str(uuid.uuid4()))
        if record[pk] in rows:
            return _err(412, "0x80040237", "A record with matching key values already exists.")
        if table == "appointments" and not record.get("scheduledend"):
            return _err(400, "0x80040203", "Attribute 'scheduledend' cannot be NULL for an appointment.")
        status_err = _check_status_pair(table, record)
        if status_err:
            return status_err
        rows[record[pk]] = record
        return 201, dict(record)

    # PATCH
    if key is None:
        return _err(405, "0x80060888", "PATCH must target a single record")
    if key not in rows:
        return _err(404, "0x80040217", f"{table[:-1]} With Id = {key} Does Not Exist")
    patch, bind_err = _resolve_binds(body)
    if bind_err:
        return bind_err
    merged = {**rows[key], **patch}
    status_err = _check_status_pair(table, merged)
    if status_err:
        return status_err
    rows[key] = merged
    return 204, None


@app.post("/v1")
async def v1(request: Request):
    try:
        env = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Body must be JSON")
    if not isinstance(env, dict) or not all(env.get(k) for k in ("contract", "request_id", "method", "path")):
        raise HTTPException(status_code=400, detail="Missing required envelope fields")

    def reply(status_code: int, body: Any) -> dict:
        return {"contract": CONTRACT, "request_id": env["request_id"], "status_code": status_code, "body": body}

    if request.headers.get("X-Loop-Key") != os.environ.get("FAKE_FLOW_KEY", "test-key"):
        return reply(401, {"error": {"message": "rejected by guard"}})
    method = str(env["method"]).upper()
    entity = re.split(r"[?(/]", env["path"], maxsplit=1)[0]
    if method not in ALLOWED_METHODS or entity not in ALLOW_LIST:
        return reply(400, {"error": {"message": "rejected by guard"}})
    status_code, body = _dispatch(method, env["path"], env.get("body"))
    return reply(status_code, body)


@app.get("/_records")
async def records():
    return STORE
