"""Timezone-safe datetime helpers for CRM payloads.

D365 stores UTC. Users type local times, so every value that leaves the app is
converted here: naive values are interpreted in the user's timezone, values with
an offset or `Z` are converted to UTC. Output is always `YYYY-MM-DDTHH:MM:SSZ`.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_UTC_FMT = "%Y-%m-%dT%H:%M:%SZ"
_DEFAULT_TZ = "Asia/Kolkata"

# Same format lists as activity_sheet_processor.combine_datetime (kept in sync by hand;
# that module belongs to another phase and must not be imported-from-changed here).
_DATE_FORMATS = [
    "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y",
    "%d-%b-%Y", "%d/%b/%Y", "%d %b %Y", "%B %d %Y",
]
_TIME_FORMATS = ["%I:%M %p", "%H:%M", "%I:%M%p", "%I %p", "%H:%M:%S"]


def _zone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise ValueError(f"Unknown timezone: {tz_name!r}")


def to_utc_iso(value: str, tz_name: str) -> str:
    """ISO string -> UTC `YYYY-MM-DDTHH:MM:SSZ`.

    Accepts `Z`/offset values (converted to UTC) and naive values
    (`YYYY-MM-DDTHH:MM[:SS]`, interpreted in `tz_name`). Raises ValueError on garbage.
    """
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Empty datetime")
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f"Unparseable datetime: {value!r}")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_zone(tz_name))
    return parsed.astimezone(timezone.utc).strftime(_UTC_FMT)


def combine_local(date_str: str, time_str: str, tz_name: str) -> str:
    """Sheet date + time strings (local to `tz_name`) -> UTC ISO. Empty/unparseable date -> ''."""
    if not date_str or not date_str.strip():
        return ""
    parsed_date: Optional[datetime] = None
    for fmt in _DATE_FORMATS:
        try:
            parsed_date = datetime.strptime(date_str.strip(), fmt)
            break
        except ValueError:
            continue
    if parsed_date is None:
        return ""

    local = parsed_date.replace(hour=0, minute=0, second=0)
    if time_str and time_str.strip():
        for fmt in _TIME_FORMATS:
            try:
                parsed_time = datetime.strptime(time_str.strip().upper(), fmt)
            except ValueError:
                continue
            local = parsed_date.replace(hour=parsed_time.hour, minute=parsed_time.minute, second=0)
            break
    return local.replace(tzinfo=_zone(tz_name)).astimezone(timezone.utc).strftime(_UTC_FMT)


def add_minutes(iso_utc: str, minutes: int) -> str:
    """Add `minutes` to a UTC ISO string produced by this module."""
    base = datetime.strptime(iso_utc, _UTC_FMT)
    return (base + timedelta(minutes=int(minutes))).strftime(_UTC_FMT)


def now_utc_minute() -> str:
    """Current UTC time rounded down to the minute, as UTC ISO."""
    return datetime.now(timezone.utc).replace(second=0, microsecond=0).strftime(_UTC_FMT)


def user_timezone(prefs: Optional[Dict[str, Any]]) -> str:
    """`prefs.timezone` -> env `DEFAULT_TIMEZONE` -> `Asia/Kolkata`. Invalid names are skipped."""
    for candidate in ((prefs or {}).get("timezone"), os.environ.get("DEFAULT_TIMEZONE"), _DEFAULT_TZ):
        if not candidate:
            continue
        try:
            _zone(candidate)
            return candidate
        except ValueError:
            continue
    return _DEFAULT_TZ
