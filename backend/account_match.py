"""Account resolution that never silently picks the wrong account.

`resolve()` maps a free-text "regarding" to one account from the user's uploaded file, or
says plainly that it could not (`ambiguous` / `none`). Callers must not call the CRM for
those two outcomes.
"""
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

from excel_processor import fuzzy_match

FUZZY_THRESHOLD = 0.6
MIN_GAP = 0.15
TYPO_THRESHOLD = 0.88

_CHAT_STOPWORDS = {"india", "with", "about", "meeting", "appointment", "call", "today", "tomorrow",
                   "yesterday", "from", "this", "that", "what", "which", "account", "accounts", "group",
                   "services", "solutions", "technologies", "systems", "please", "activity", "logged"}

_SUFFIXES = {"ltd", "limited", "pvt", "private", "inc", "llc", "corp", "corporation", "co"}


def normalize(name: str) -> str:
    """Lowercase, strip punctuation, collapse spaces, drop company suffixes."""
    tokens = [t for t in re.split(r"[\W_]+", (name or "").lower()) if t]
    kept = [t for t in tokens if t not in _SUFFIXES]
    return " ".join(kept or tokens)


def pick_mdm(doc: Dict[str, Any]) -> str:
    """IDG if non-empty, else ISG."""
    return (doc.get("l2_mdm_id_idg") or doc.get("l2_mdm_id_isg") or "").strip()


def clean_mdm(value: Any) -> str:
    """Excel hands numeric IDs back as '12345.0' — strip that."""
    s = str(value or "").strip()
    return s[:-2] if re.fullmatch(r"\d+\.0", s) else s


def resolve_row(regarding: str, mdm_id: Any, accounts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Resolve a sheet row. An MDM ID column wins over the account name.

    MDM ID found in the account list → `exact` (canonical name from the list).
    MDM ID not in the list → `mdm`: D365 links the record on the MDM ID itself, so it is still
    sendable, named after the row's "regarding" text. No MDM ID → name resolution via `resolve()`.
    """
    mdm = clean_mdm(mdm_id)
    if not mdm:
        return resolve(regarding, accounts)
    hits = [a for a in accounts
            if mdm in (clean_mdm(a.get("l2_mdm_id_idg")), clean_mdm(a.get("l2_mdm_id_isg")))]
    if hits:
        return _result("exact", hits[0], 1.0, [_candidate(hits[0], 1.0)])
    result = _result("mdm", None, 1.0, [])
    result.update(account_name=(regarding or "").strip() or mdm, mdm_id_idg=mdm)
    return result


def lookup_in_text(text: str, accounts: List[Dict[str, Any]], limit: int = 10) -> List[Dict[str, Any]]:
    """Accounts a chat message refers to: any MDM ID it contains, or any account sharing a
    distinctive word (4+ letters) with it. Ranked by words shared; feeds the AI's live state."""
    lowered = (text or "").lower()
    words = {t for t in normalize(text).split() if len(t) >= 4} - _CHAT_STOPWORDS
    scored = []
    for a in accounts:
        ids = [clean_mdm(a.get("l2_mdm_id_idg")), clean_mdm(a.get("l2_mdm_id_isg"))]
        if any(i and i.lower() in lowered for i in ids):
            scored.append((100, a))
            continue
        shared = words & set(normalize(a.get("account_name", "")).split())
        if shared:
            scored.append((len(shared), a))
    scored.sort(key=lambda x: -x[0])
    return [{"account_name": a.get("account_name", ""),
             "mdm_id_idg": a.get("l2_mdm_id_idg", "") or "",
             "mdm_id_isg": a.get("l2_mdm_id_isg", "") or ""} for _, a in scored[:limit]]


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
        "candidates": candidates[:8],
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

    # 3. Short form: every word of the query appears in exactly one account ("Aurobindo" →
    #    "AUROBINDO PHARMA LIMITED"). Needs one word of 4+ letters so "India" alone never matches.
    q_tokens = set(norm_query.split())
    if any(len(t) >= 4 for t in q_tokens):
        contains = [k for k in by_name if q_tokens <= set(k.split())]
        if len(contains) == 1 and len(by_name[contains[0]]) == 1:
            doc = by_name[contains[0]][0]
            score = len(q_tokens) / len(set(contains[0].split()))
            return _result("fuzzy", doc, score, [_candidate(doc, score)])
        if len(contains) > 1:   # "Apollo" → every Apollo account, for the user to pick
            docs = [a for k in contains for a in by_name[k]]
            return _result("ambiguous", None, 0.0, [_candidate(a, 0.0) for a in docs])

    # 4. Fuzzy
    matches = fuzzy_match(norm_query, list(by_name), threshold=FUZZY_THRESHOLD, top_n=3)
    candidates: List[Dict[str, Any]] = []
    for score, key in matches:
        for a in by_name[key]:
            candidates.append(_candidate(a, score))
    if not matches:
        # 5. Spelling slips ("tata advance systems" → "tata advanced systems"): character similarity.
        ratios = sorted(((SequenceMatcher(None, norm_query, k).ratio(), k) for k in by_name), reverse=True)
        if ratios and ratios[0][0] >= TYPO_THRESHOLD:
            best, key = ratios[0]
            close = [k for r, k in ratios if best - r < MIN_GAP / 2]
            if len(close) == 1 and len(by_name[key]) == 1:
                return _result("fuzzy", by_name[key][0], best, [_candidate(by_name[key][0], best)])
            docs = [a for k in close for a in by_name[k]]
            return _result("ambiguous", None, best, [_candidate(a, best) for a in docs])
        return _result("none", None, 0.0, [])

    top_score, top_key = matches[0]
    runner_up = matches[1][0] if len(matches) > 1 else None
    clear_lead = runner_up is None or (top_score - runner_up) >= MIN_GAP
    if clear_lead and len(by_name[top_key]) == 1:
        return _result("fuzzy", by_name[top_key][0], top_score, candidates)
    return _result("ambiguous", None, top_score, candidates)
