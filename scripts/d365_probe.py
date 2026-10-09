"""D365 probe — talks to the `loop.crm.v1` flow (docs/revamp/ARCHITECTURE.md §4). Read-only by default.

Config: LOOP_FLOW_URL, LOOP_FLOW_KEY (and optional LOOP_ORG_URL for canary links) from the
environment, else from docs/revamp/private/.env.probe (or --env-file). Secrets are never printed;
only the flow host is shown.

  python scripts/d365_probe.py whoami
  python scripts/d365_probe.py account --filter lvo_mdmid=1001 [--filter <field>=<value> ...]
  python scripts/d365_probe.py metadata appointment [--relationships]
  python scripts/d365_probe.py canary --mdm 1001 --i-have-user-approval

Against the fake flow:  LOOP_FLOW_URL=http://localhost:8765/v1 LOOP_FLOW_KEY=test-key python scripts/d365_probe.py whoami
"""
import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx

CONTRACT = "loop.crm.v1"
DEFAULT_ENV_FILE = Path(__file__).resolve().parent.parent / "docs" / "revamp" / "private" / ".env.probe"


def load_config(env_file: Path) -> dict:
    cfg = {}
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("LOOP_FLOW_URL", "LOOP_FLOW_KEY", "LOOP_ORG_URL"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    missing = [k for k in ("LOOP_FLOW_URL", "LOOP_FLOW_KEY") if not cfg.get(k)]
    if missing:
        sys.exit(f"Missing {', '.join(missing)} (set env vars or fill {env_file})")
    return cfg


def odata_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def call(cfg: dict, method: str, path: str, body=None) -> dict:
    envelope = {"contract": CONTRACT, "request_id": str(uuid.uuid4()), "method": method, "path": path, "body": body}
    host = urlsplit(cfg["LOOP_FLOW_URL"]).netloc
    print(f"-> {method} {path}  (flow host: {host})")
    try:
        r = httpx.post(cfg["LOOP_FLOW_URL"], json=envelope, headers={"X-Loop-Key": cfg["LOOP_FLOW_KEY"]}, timeout=60)
    except httpx.HTTPError as e:
        sys.exit(f"FLOW_UNREACHABLE: {type(e).__name__}")
    if not r.content:
        sys.exit(f"FLOW_CONTRACT_VIOLATION: HTTP {r.status_code} with empty body "
                 "(the flow's final Response action is missing or not reached)")
    try:
        data = r.json()
    except ValueError:
        sys.exit(f"FLOW_CONTRACT_VIOLATION: HTTP {r.status_code}, non-JSON body")
    if data.get("contract") != CONTRACT or "status_code" not in data:
        sys.exit(f"FLOW_CONTRACT_VIOLATION: HTTP {r.status_code}, body keys {sorted(data)}")
    if data.get("request_id") != envelope["request_id"]:
        print("warning: request_id not echoed")
    return data


def show(data: dict) -> int:
    print(f"status_code: {data['status_code']}")
    print(json.dumps(data.get("body"), indent=2, ensure_ascii=False))
    return 0 if 200 <= int(data["status_code"]) < 300 else 1


def cmd_whoami(cfg, _args) -> int:
    return show(call(cfg, "GET", "WhoAmI"))


def account_path(filters: list, select: str = "accountid,name", top: int = 5) -> str:
    clauses = []
    for f in filters:
        field, sep, value = f.partition("=")
        if not sep or not field.strip():
            sys.exit(f"Bad --filter {f!r}; use <logical_name>=<value>")
        clauses.append(f"{field.strip()} eq {odata_literal(value)}")
    return f"accounts?$select={select}&$filter={' and '.join(clauses)}&$top={top}"


def cmd_account(cfg, args) -> int:
    data = call(cfg, "GET", account_path(args.filter))
    rc = show(data)
    if rc == 0:
        print(f"matched: {len((data.get('body') or {}).get('value', []))}")
    return rc


def cmd_metadata(cfg, args) -> int:
    entity = args.entity.replace("'", "")
    if args.relationships:
        path = (f"EntityDefinitions(LogicalName='{entity}')/ManyToOneRelationships"
                "?$select=ReferencingEntityNavigationPropertyName,ReferencedEntity,ReferencingAttribute")
    else:
        path = (f"EntityDefinitions(LogicalName='{entity}')/Attributes"
                "?$select=LogicalName,AttributeType,RequiredLevel")
    return show(call(cfg, "GET", path))


def cmd_canary(cfg, args) -> int:
    if not args.i_have_user_approval:
        sys.exit("Refusing: canary writes to the live tenant. Re-run with --i-have-user-approval "
                 "only after the user typed explicit approval in this session.")
    found = call(cfg, "GET", account_path([f"{args.mdm_field}={args.mdm}"], top=2))
    accounts = (found.get("body") or {}).get("value", []) if found["status_code"] == 200 else []
    if len(accounts) != 1:
        show(found)
        sys.exit(f"Canary aborted: expected exactly 1 account for {args.mdm_field}={args.mdm}, got {len(accounts)}")
    account_id = accounts[0]["accountid"]

    activity_id = str(uuid.uuid4())
    start = datetime.now(timezone.utc).replace(microsecond=0)
    body = {
        "activityid": activity_id,
        "subject": f"[LOOP-CANARY] P0 probe {start.isoformat()}",
        "description": "Created by scripts/d365_probe.py canary. Safe to delete.",
        "scheduledstart": start.isoformat().replace("+00:00", "Z"),
        "scheduledend": (start + timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
        f"{args.regarding_nav}@odata.bind": f"/accounts({account_id})",
    }
    created = call(cfg, "POST", "appointments", body)
    if show(created):
        return 1
    read = call(cfg, "GET", f"appointments({activity_id})?$select=activityid,subject,scheduledstart,scheduledend,statecode")
    rc = show(read)
    print(f"canary activityid: {activity_id}  read-back: {'OK' if rc == 0 else 'FAILED'}")
    if cfg.get("LOOP_ORG_URL"):
        print(f"open: {cfg['LOOP_ORG_URL'].rstrip('/')}/main.aspx?etn=appointment&pagetype=entityrecord&id={activity_id}")
    print("Delete this record in D365 when done.")
    return rc


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("whoami")
    a = sub.add_parser("account")
    a.add_argument("--filter", action="append", required=True, help="<logical_name>=<value>, repeatable (ANDed)")
    m = sub.add_parser("metadata")
    m.add_argument("entity", help="logical name, e.g. appointment")
    m.add_argument("--relationships", action="store_true", help="list many-to-one navigation properties")
    c = sub.add_parser("canary")
    c.add_argument("--mdm", required=True)
    c.add_argument("--mdm-field", default="lvo_mdmid")
    c.add_argument("--regarding-nav", default="regardingobjectid_account_appointment")
    c.add_argument("--i-have-user-approval", action="store_true")
    args = p.parse_args(argv)
    handlers = {"whoami": cmd_whoami, "account": cmd_account, "metadata": cmd_metadata, "canary": cmd_canary}
    if args.cmd == "canary" and not args.i_have_user_approval:
        return handlers["canary"](None, args)
    return handlers[args.cmd](load_config(args.env_file), args)


if __name__ == "__main__":
    sys.exit(main())
