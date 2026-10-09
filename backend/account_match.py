"""Account resolution that never silently picks the wrong account.

`resolve()` maps a free-text "regarding" to one account from the user's uploaded file, or
says plainly that it could not (`ambiguous` / `none`). Callers must not call the CRM for
those two outcomes.
"""
import re
from typing import Any, Dict, List, Optional

from excel_processor import fuzzy_match

FUZZY_THRESHOLD = 0.6
MIN_GAP = 0.15

_SUFFIXES = {"ltd", "limited", "pvt", "private", "inc", "llc", "corp", "corporation", "co"}


def normalize(name: str) -> str:
    """Lowercase, strip punctuation, collapse spaces, drop company suffixes."""
    tokens = [t for t in re.split(r"[\W_]+", (name or "").lower()) if t]
    kept = [t for t in tokens if t not in _SUFFIXES]
    return " ".join(kept or tokens)


def pick_mdm(doc: Dict[str, Any]) -> str:
    """IDG if non-empty, else ISG."""
    return (doc.get("l2_mdm_id_idg") or doc.get("l2_mdm_id_isg") or "").strip()


def _candidate(doc: Dict[str, Any], score: float) -> Dict[str, Any]:
    return {
        "account_name": doc.get("account_name", ""),
        "mdm_id_idg": doc.get("l2_mdm_id_idg", "") or "",
        "mdm_id_isg": doc.get("l2_mdm_id_isg", "") or "",
        "score": round(score, 2),
    }


def _result(status: str, doc: Optional[Dict[str, Any]], score: float, candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "status": status,
        "account_name": doc.get("account_name", "") if doc else "",
        "mdm_id_idg": (doc.get("l2_mdm_id_idg", "") or "") if doc else "",
        "mdm_id_isg": (doc.get("l2_mdm_id_isg", "") or "") if doc else "",
        "score": round(score, 2),
        "candidates": candidates[:3],
    }


def resolve(regarding: str, accounts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Resolve `regarding` against account docs (`account_name`, `l2_mdm_id_idg`, `l2_mdm_id_isg`).

    Order: exact MDM ID, exact normalized name, then Jaccard fuzzy (>= 0.6 and a clear
    0.15 lead over the runner-up). Several accounts sharing the winning exact key is ambiguous.
    """
    query = (regarding or "").strip()
    if not query or not accounts:
        return _result("none", None, 0.0, [])

    # 1. Exact MDM ID (IDG or ISG)
    by_mdm = [a for a in accounts if query in (a.get("l2_mdm_id_idg"), a.get("l2_mdm_id_isg"))]
    if len(by_mdm) == 1:
        return _result("exact", by_mdm[0], 1.0, [_candidate(by_mdm[0], 1.0)])
    if len(by_mdm) > 1:
        return _result("ambiguous", None, 1.0, [_candidate(a, 1.0) for a in by_mdm])

    # 2. Exact normalized name
    norm_query = normalize(query)
    by_name: Dict[str, List[Dict[str, Any]]] = {}
    for a in accounts:
        key = normalize(a.get("account_name", ""))
        if key:
            by_name.setdefault(key, []).append(a)
    exact = by_name.get(norm_query, [])
    if len(exact) == 1:
        return _result("exact", exact[0], 1.0, [_candidate(exact[0], 1.0)])
    if len(exact) > 1:
        return _result("ambiguous", None, 1.0, [_candidate(a, 1.0) for a in exact])

    # 3. Fuzzy
    matches = fuzzy_match(norm_query, list(by_name), threshold=FUZZY_THRESHOLD, top_n=3)
    candidates: List[Dict[str, Any]] = []
    for score, key in matches:
        for a in by_name[key]:
            candidates.append(_candidate(a, score))
    if not matches:
        return _result("none", None, 0.0, [])

    top_score, top_key = matches[0]
    runner_up = matches[1][0] if len(matches) > 1 else None
    clear_lead = runner_up is None or (top_score - runner_up) >= MIN_GAP
    if clear_lead and len(by_name[top_key]) == 1:
        return _result("fuzzy", by_name[top_key][0], top_score, candidates)
    return _result("ambiguous", None, top_score, candidates)
