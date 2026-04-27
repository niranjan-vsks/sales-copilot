"""
Logging configuration for Sales Copilot.
Creates daily log files in backend/instance/ with format: log_copilot_DD_MM_YYYY.log
Logs rotate at midnight; 30 days retained.
"""
import logging
import logging.handlers
from datetime import datetime
from pathlib import Path

_LOG_DIR = Path(__file__).parent / "instance"
_FMT = "%(asctime)s | %(levelname)-8s | %(name)-30s | %(message)s"
_DATE_FMT = "%Y-%m-%d %H:%M:%S"


def _rotated_namer(default_name: str) -> str:
    """Rename rotated files from .log.YYYY-MM-DD → log_copilot_DD_MM_YYYY.log"""
    p = Path(default_name)
    suffix = p.suffix.lstrip(".")          # e.g. "2026-03-15"
    try:
        d = datetime.strptime(suffix, "%Y-%m-%d")
        return str(_LOG_DIR / f"log_copilot_{d.strftime('%d_%m_%Y')}.log")
    except ValueError:
        return default_name


def setup_logging(level: int = logging.DEBUG) -> None:
    """
    Call once at application startup.
    Attaches a daily-rotating file handler and a console handler to the root logger.
    """
    _LOG_DIR.mkdir(parents=True, exist_ok=True)

    today = datetime.now().strftime("%d_%m_%Y")
    log_file = _LOG_DIR / f"log_copilot_{today}.log"

    formatter = logging.Formatter(_FMT, datefmt=_DATE_FMT)

    # ── Daily-rotating file handler ──────────────────────────────────────────
    file_handler = logging.handlers.TimedRotatingFileHandler(
        filename=str(log_file),
        when="midnight",
        backupCount=30,
        encoding="utf-8",
        utc=False,
    )
    file_handler.namer = _rotated_namer
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.DEBUG)

    # ── Console handler (INFO and above) ─────────────────────────────────────
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.INFO)

    # ── Root logger ───────────────────────────────────────────────────────────
    root = logging.getLogger()
    root.setLevel(level)

    # Avoid duplicate handlers if called more than once (e.g. uvicorn --reload)
    if not any(isinstance(h, logging.handlers.TimedRotatingFileHandler) for h in root.handlers):
        root.addHandler(file_handler)
    if not any(isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler) for h in root.handlers):
        root.addHandler(console_handler)

    # Quiet down noisy third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
    logging.getLogger("motor").setLevel(logging.WARNING)
    logging.getLogger("msal").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
