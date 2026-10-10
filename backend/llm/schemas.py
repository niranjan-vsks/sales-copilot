"""Schemas the model's JSON output is validated against before anything acts on it."""
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

ACTIVITY_TYPES = ("appointment", "phonecall", "task")


def _has_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


class ChatDecision(BaseModel):
    action: Literal["trigger_workflow", "answer", "guide"]
    workflow_type: Optional[Literal["appointment", "phonecall", "task", "activity_sheet"]] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    clarification_needed: bool = False
    user_message: str = Field(min_length=1, max_length=2000)

    @field_validator("workflow_type", mode="before")
    @classmethod
    def _null_workflow_type(cls, v):
        return None if v in ("null", "None", "") else v

    @field_validator("payload", mode="before")
    @classmethod
    def _null_payload(cls, v):
        return {} if v is None else v

    @model_validator(mode="after")
    def _guard_trigger(self):
        """A workflow only fires when its required fields are present; otherwise ask, never guess."""
        if self.action != "trigger_workflow":
            return self
        problem = self._missing()
        if problem:
            self.action = "answer"
            self.clarification_needed = True
            if "?" not in self.user_message:
                self.user_message = f"I need {problem} before I can do that. Could you provide it?"
        return self

    def _missing(self) -> Optional[str]:
        wt, payload = self.workflow_type, self.payload
        if wt in ACTIVITY_TYPES:
            missing: List[str] = [k for k in ("subject", "account") if not _has_text(payload.get(k))]
            if missing:
                return " and ".join(f"the {k}" for k in missing)
            if "duration_minutes" in payload:
                try:
                    minutes = int(payload["duration_minutes"])
                except (TypeError, ValueError):
                    minutes = 0
                if not 1 <= minutes <= 1440:
                    return "a duration between 1 and 1440 minutes"
                payload["duration_minutes"] = minutes
            return None
        if wt == "activity_sheet":
            rows = payload.get("rows")
            if not isinstance(rows, list) or not rows:
                return "the rows of the activity sheet"
            return None
        return "which kind of activity to log"
