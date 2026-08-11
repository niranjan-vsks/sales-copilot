"""
Activity Sheet Processor — parse pasted text or uploaded Excel/CSV into structured meeting rows.

Expected columns (case-insensitive, flexible aliases):
  Serial No, Sno, S.No, ID, No, #
  Date
  Time
  Regarding, Account, Company, Customer
  Notes, Description, Remarks, Discussion
  Primary Lenovo Attendee (optional — auto-filled from logged-in user)
"""
import csv
import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

COLUMN_ALIASES: Dict[str, List[str]] = {
    "serial_no":        ["serial no", "sno", "s no", "serial number", "sr no", "sr", "id", "no", "#", "serial"],
    "date":             ["date", "meeting date", "activity date", "visit date"],
    "time":             ["time", "meeting time", "start time", "visit time"],
    "regarding":        ["regarding", "account", "company", "account name", "customer", "customer name", "client"],
    "notes":            ["notes", "note", "description", "details", "remarks", "comments", "discussion"],
    "primary_attendee": ["primary lenovo attendee", "lenovo attendee", "attendee", "rep", "primary attendee"],
}


def _normalize(s: str) -> str:
    return re.sub(r"[._/]", " ", s.strip().lower()).strip()


def map_columns(headers: List[str]) -> Dict[str, str]:
    """Return {canonical_field: original_header} mapping via alias lookup."""
    mapping: Dict[str, str] = {}
    for header in headers:
        norm = _normalize(header)
        for field, aliases in COLUMN_ALIASES.items():
            if field in mapping:
                continue
            if norm in aliases:
                mapping[field] = header
                break
            for alias in aliases:
                if alias in norm or norm in alias:
                    mapping[field] = header
                    break
    return mapping


def parse_text(text: str) -> Tuple[List[str], List[Dict[str, str]]]:
    """Parse pasted text — supports markdown tables, TSV (Excel copy-paste), and CSV."""
    text = text.strip()
    if not text:
        return [], []

    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return [], []

    # Markdown table (has pipe characters)
    if "|" in lines[0]:
        return _parse_markdown(lines)

    # TSV — Excel copy-paste uses tab delimiter
    if "\t" in lines[0]:
        return _parse_delimited(lines, delimiter="\t")

    # Fall back to CSV
    return _parse_delimited(lines, delimiter=",")


def _parse_markdown(lines: List[str]) -> Tuple[List[str], List[Dict[str, str]]]:
    # Filter out separator rows (---|---) and blank lines
    data_lines = [
        l for l in lines
        if "|" in l and not re.match(r"^\s*\|[\s\-|]+\|\s*$", l)
    ]
    if not data_lines:
        return [], []

    def split_row(line: str) -> List[str]:
        return [c.strip() for c in line.strip().strip("|").split("|")]

    headers = split_row(data_lines[0])
    rows: List[Dict[str, str]] = []
    for line in data_lines[1:]:
        cols = split_row(line)
        # Pad short rows
        while len(cols) < len(headers):
            cols.append("")
        rows.append(dict(zip(headers, cols[:len(headers)])))

    return headers, rows


def _parse_delimited(lines: List[str], delimiter: str) -> Tuple[List[str], List[Dict[str, str]]]:
    text = "\n".join(lines)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    headers = list(reader.fieldnames or [])
    rows = [dict(row) for row in reader]
    return headers, rows


def _normalize_serial_no(val: str) -> str:
    """Convert float-strings from Excel numeric cells: '1.0' → '1', '23.0' → '23'."""
    val = val.strip()
    try:
        f = float(val)
        if f == int(f):
            return str(int(f))
    except (ValueError, OverflowError):
        pass
    return val


def normalize_rows(
    raw_rows: List[Dict[str, str]],
    col_mapping: Dict[str, str],
) -> List[Dict[str, str]]:
    """Convert rows with original header keys to canonical field names."""
    result: List[Dict[str, str]] = []
    for raw in raw_rows:
        row: Dict[str, str] = {}
        for field, header in col_mapping.items():
            val = str(raw.get(header, "") or "").strip()
            if field == "serial_no":
                val = _normalize_serial_no(val)
            row[field] = val
        # Ensure all canonical fields exist
        for field in COLUMN_ALIASES:
            row.setdefault(field, "")
        result.append(row)
    return result


def combine_datetime(date_str: str, time_str: str) -> str:
    """Combine date + time strings into ISO 8601 UTC format for D365."""
    if not date_str:
        return ""

    date_formats = [
        "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y",
        "%d-%b-%Y", "%d/%b/%Y", "%d %b %Y", "%B %d %Y",
    ]
    parsed_date: Optional[datetime] = None
    for fmt in date_formats:
        try:
            parsed_date = datetime.strptime(date_str.strip(), fmt)
            break
        except ValueError:
            continue

    if not parsed_date:
        return ""

    if time_str and time_str.strip():
        time_formats = ["%I:%M %p", "%H:%M", "%I:%M%p", "%I %p", "%H:%M:%S"]
        for fmt in time_formats:
            try:
                parsed_time = datetime.strptime(time_str.strip().upper(), fmt)
                combined = parsed_date.replace(
                    hour=parsed_time.hour, minute=parsed_time.minute, second=0
                )
                return combined.strftime("%Y-%m-%dT%H:%M:00Z")
            except ValueError:
                continue

    return parsed_date.strftime("%Y-%m-%dT00:00:00Z")


async def summarize_notes(
    notes: str,
    account: str,
    date: str,
    groq_client: Any,
    model: str = "llama-3.1-8b-instant",
) -> str:
    """Use Groq to convert informal notes into a professional CRM summary."""
    if not notes or not notes.strip():
        return ""

    prompt_path = Path(__file__).parent / "prompts" / "notes_summarizer.txt"
    template = prompt_path.read_text(encoding="utf-8")
    user_prompt = (
        template
        .replace("__ACCOUNT__", account)
        .replace("__DATE__", date)
        .replace("__NOTES__", notes)
    )

    try:
        response = await groq_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": user_prompt}],
            temperature=0.2,
            max_tokens=300,
        )
        return response.choices[0].message.content.strip()
    except Exception:
        return notes  # Graceful fallback: keep original notes
