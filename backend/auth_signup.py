"""
Signup flow: email/OTP verification before account creation.

Factory: create_signup_router(db, cookie_sec_fn, session_expiry_days)
Mounted under /api prefix by server.py's api_router.

Endpoints:
  POST /auth/signup       — validate + send OTP, create pending_verification
  POST /auth/verify-email — confirm OTP, create user + session
  POST /auth/resend-otp   — resend OTP (60-second cooldown)
"""
import re
import random
import secrets
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

import bcrypt
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from email_service import send_otp_email

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class SignupRequest(BaseModel):
    email: str
    password: str
    name: str


class VerifyRequest(BaseModel):
    email: str
    otp: str


class ResendRequest(BaseModel):
    email: str


def _validate_password(pw: str) -> Optional[str]:
    if len(pw) < 8:
        return "Password must be at least 8 characters."
    if not re.search(r"[A-Z]", pw):
        return "Password must contain at least 1 uppercase letter."
    if not re.search(r"\d", pw):
        return "Password must contain at least 1 number."
    if not re.search(r"[^A-Za-z0-9]", pw):
        return "Password must contain at least 1 special character."
    return None


def create_signup_router(db, cookie_sec_fn: Callable, session_expiry_days: int) -> APIRouter:
    router = APIRouter()

    @router.post("/auth/signup")
    async def signup(body: SignupRequest):
        email = body.email.lower().strip()
        name = body.name.strip()

        if not _EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Invalid email format.")

        pw_error = _validate_password(body.password)
        if pw_error:
            raise HTTPException(status_code=400, detail=pw_error)

        existing = await db.users.find_one({"email": email})
        if existing:
            if existing.get("auth_method") == "microsoft":
                raise HTTPException(
                    status_code=409,
                    detail="This email is linked to a Microsoft account. Please sign in with Microsoft.",
                )
            raise HTTPException(status_code=409, detail="Account already exists. Please sign in.")

        # Clear any stale pending record for this email before creating new one
        await db.pending_verifications.delete_many({"email": email})

        otp = str(random.randint(100000, 999999))
        hashed_pw = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt(rounds=12)).decode()
        otp_hash = bcrypt.hashpw(otp.encode(), bcrypt.gensalt(rounds=12)).decode()

        await db.pending_verifications.insert_one({
            "email": email,
            "name": name,
            "hashed_password": hashed_pw,
            "otp_hash": otp_hash,
            "otp_expiry": datetime.now(timezone.utc) + timedelta(minutes=10),
            "attempts": 0,
            "created_at": datetime.now(timezone.utc),
        })

        try:
            send_otp_email(to_email=email, otp=otp, name=name)
        except Exception as exc:
            logger.error("OTP email failed for %s: %s", email, exc)
            await db.pending_verifications.delete_many({"email": email})
            raise HTTPException(
                status_code=500,
                detail="Failed to send verification email. Check SMTP configuration.",
            )

        return {"success": True, "data": {"email": email}, "error": None}

    @router.post("/auth/verify-email")
    async def verify_email(body: VerifyRequest):
        email = body.email.lower().strip()
        pending = await db.pending_verifications.find_one({"email": email})

        if not pending:
            raise HTTPException(
                status_code=404,
                detail="No pending verification found. Please sign up again.",
            )

        if datetime.now(timezone.utc) > pending["otp_expiry"]:
            await db.pending_verifications.delete_many({"email": email})
            raise HTTPException(
                status_code=400,
                detail="Verification code expired. Please sign up again.",
            )

        if pending["attempts"] >= 5:
            await db.pending_verifications.delete_many({"email": email})
            raise HTTPException(
                status_code=400,
                detail="Too many failed attempts. Please sign up again.",
            )

        if not bcrypt.checkpw(body.otp.encode(), pending["otp_hash"].encode()):
            remaining = 4 - pending["attempts"]
            await db.pending_verifications.update_one(
                {"email": email}, {"$inc": {"attempts": 1}}
            )
            raise HTTPException(
                status_code=400,
                detail=f"Invalid code. {remaining} attempt(s) remaining.",
            )

        user_id = f"user_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc)

        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": pending["name"],
            "hashed_password": pending["hashed_password"],
            "auth_method": "email",
            "is_verified": True,
            "role": "rep",
            "created_at": now,
            "last_login": now,
        })

        # Mirror into authorized_users so /auth/login can authenticate them immediately
        if not await db.authorized_users.find_one({"email": email}):
            await db.authorized_users.insert_one({
                "email": email,
                "display_name": pending["name"],
                "role": "rep",
                "password_hash": pending["hashed_password"],
                "added_by": "self-signup",
                "added_at": now,
            })

        await db.pending_verifications.delete_many({"email": email})

        session_token = secrets.token_hex(32)
        await db.user_sessions.insert_one({
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": now + timedelta(days=session_expiry_days),
            "created_at": now,
        })

        resp = JSONResponse({
            "success": True,
            "data": {
                "user_id": user_id,
                "email": email,
                "name": pending["name"],
                "role": "rep",
            },
            "error": None,
        })
        resp.set_cookie(
            "session_token", session_token,
            path="/", max_age=session_expiry_days * 24 * 60 * 60,
            **cookie_sec_fn(),
        )
        return resp

    @router.post("/auth/resend-otp")
    async def resend_otp(body: ResendRequest):
        email = body.email.lower().strip()
        pending = await db.pending_verifications.find_one({"email": email})

        if not pending:
            raise HTTPException(
                status_code=404,
                detail="No pending verification. Please sign up first.",
            )

        elapsed = (datetime.now(timezone.utc) - pending["created_at"]).total_seconds()
        if elapsed < 60:
            wait = int(60 - elapsed)
            raise HTTPException(
                status_code=429,
                detail=f"Please wait {wait} seconds before requesting a new code.",
            )

        otp = str(random.randint(100000, 999999))
        otp_hash = bcrypt.hashpw(otp.encode(), bcrypt.gensalt(rounds=12)).decode()
        now = datetime.now(timezone.utc)

        await db.pending_verifications.update_one(
            {"email": email},
            {"$set": {
                "otp_hash": otp_hash,
                "otp_expiry": now + timedelta(minutes=10),
                "attempts": 0,
                "created_at": now,
            }},
        )

        try:
            send_otp_email(to_email=email, otp=otp, name=pending.get("name", ""))
        except Exception as exc:
            logger.error("OTP resend failed for %s: %s", email, exc)
            raise HTTPException(
                status_code=500,
                detail="Failed to send email. Check SMTP configuration.",
            )

        return {"success": True, "data": {}, "error": None}

    return router
