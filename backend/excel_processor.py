"""
Excel / CSV parsing and account fuzzy-matching utilities.
No external ML deps — pure stdlib token overlap.
"""
import io
import re
from typing import Any, Dict, List, Optional, Tuple

import openpyxl


# ─── Column auto-detection ────────────────────────────────────────────────────

def _normalize(header: str) -> str:
    """Collapse spaces, underscores, dashes → underscore, then lowercase."""
    return re.sub(r'[\s_\-]+', '_', header.lower().strip())


def _col_matches(header: str, *keywords: str) -> bool:
    """Case-insensitive check: normalized header contains ALL normalized keywords."""
    h = _normalize(header)
    return all(_normalize(k) in h for k in keywords)


def detect_account_columns(headers: List[str]) -> Dict[str, Optional[str]]:
    """
    Inspect a list of column headers and return a mapping of canonical field
    names to the detected header string.

    Canonical fields:
      - l2_mdm_id_idg   → header contains "IDG"
      - l2_mdm_id_isg   → header contains "ISG"
      - account_name    → header contains "party name/name", "account name",
                          "customer name", "company name", or "client name"
      - parent_child    → header contains "parent" AND "child"
      - parent_name     → header contains "parent" AND "name" (but NOT "child")
    """
    mapping: Dict[str, Optional[str]] = {
        "l2_mdm_id_idg": None,
        "l2_mdm_id_isg": None,
        "account_name": None,
        "parent_child": None,
        "parent_name": None,
    }

    for h in headers:
        hn = _normalize(h)
        if mapping["l2_mdm_id_idg"] is None and "idg" in hn:
            mapping["l2_mdm_id_idg"] = h
        elif mapping["l2_mdm_id_isg"] is None and "isg" in hn:
            mapping["l2_mdm_id_isg"] = h
        elif mapping["l2_mdm_id_idg"] is None and "mdm" in hn and "id" in hn:
            # Plain "L2 MDM ID" / "MDM ID" with no IDG/ISG qualifier → treat as IDG
            mapping["l2_mdm_id_idg"] = h
        elif mapping["account_name"] is None and (
            "party_name" in hn
            or ("account" in hn and "name" in hn)
            or ("customer" in hn and "name" in hn)
            or ("company" in hn and "name" in hn)
            or ("client" in hn and "name" in hn)
        ):
            mapping["account_name"] = h
        elif mapping["parent_child"] is None and "parent" in hn and "child" in hn:
            mapping["parent_child"] = h
        elif mapping["parent_name"] is None and "parent" in hn and "name" in hn and "child" not in hn:
            mapping["parent_name"] = h

    # Last-resort fallback: use the first column that isn't an MDM ID column
    if mapping["account_name"] is None:
        mdm_cols = {mapping["l2_mdm_id_idg"], mapping["l2_mdm_id_isg"]}
        for h in headers:
            if h not in mdm_cols:
                mapping["account_name"] = h
                break

    return mapping


# ─── Excel parsing ────────────────────────────────────────────────────────────

def parse_excel(file_bytes: bytes) -> List[Dict[str, Any]]:
    """Parse an .xlsx file and return rows as list of dicts.

    Keys are the original column headers from row 1.
    Skips entirely empty rows.
    """
    wb = openpyxl.load_workbook(filename=io.BytesIO(file_bytes), read_only=True, data_only=True)
    ws = wb.active
    all_rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if not all_rows:
        return []

    raw_headers = all_rows[0]
    headers = [
        str(h).strip() if h is not None else f"col_{i}"
        for i, h in enumerate(raw_headers)
    ]

    result = []
    for row in all_rows[1:]:
        if not any(cell is not None for cell in row):
            continue
        result.append(dict(zip(headers, row)))

    return result


def parse_csv(file_bytes: bytes) -> List[Dict[str, Any]]:
    """Parse a CSV file and return rows as list of dicts.

    Tries UTF-8 then latin-1 encoding. Skips entirely empty rows.
    """
    import csv

    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = file_bytes.decode(encoding)
            break
        except (UnicodeDecodeError, LookupError):
            continue
    else:
        raise ValueError("Unable to decode CSV file — unsupported encoding")

    reader = csv.DictReader(io.StringIO(text))
    result = []
    for row in reader:
        stripped = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
        if any(v for v in stripped.values()):
            result.append(stripped)
    return result


def parse_file(file_bytes: bytes, filename: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Dispatch to the right parser based on file extension.

    Returns (rows, headers).
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in ("xls", "xlsx"):
        rows = parse_excel(file_bytes)
    elif ext == "csv":
        rows = parse_csv(file_bytes)
    else:
        raise ValueError(f"Unsupported file type: .{ext}  (expected .xlsx or .csv)")

    headers = list(rows[0].keys()) if rows else []
    return rows, headers


# ─── Fuzzy matching ───────────────────────────────────────────────────────────

def fuzzy_match(
    name: str,
    candidates: List[str],
    threshold: float = 0.4,
    top_n: int = 3,
) -> List[Tuple[float, str]]:
    """Token overlap fuzzy match. Returns top_n (score, candidate) pairs above threshold.

    Uses Jaccard similarity on word tokens — no external deps.
    """
    query_tokens = set(re.split(r"[\W_]+", name.lower())) - {""}
    if not query_tokens:
        return []

    scored: List[Tuple[float, str]] = []
    for c in candidates:
        c_tokens = set(re.split(r"[\W_]+", c.lower())) - {""}
        if not c_tokens:
            continue
        intersection = len(query_tokens & c_tokens)
        union = len(query_tokens | c_tokens)
        score = intersection / union if union else 0.0
        if score >= threshold:
            scored.append((score, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_n]
