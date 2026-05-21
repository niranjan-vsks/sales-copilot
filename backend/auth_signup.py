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
import hmac
import hashlib
import secrets
import uuid
import os
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

import bcrypt
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from email_service import send_otp_email
from payload_crypto import decrypt_field as _decrypt

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Fail hard at startup if SECRET_KEY is missing — a weak default would let
# attackers precompute all 900k OTP HMAC digests offline.
_SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not _SECRET_KEY:
    raise RuntimeError("SECRET_KEY env var is required")
_OTP_HMAC_KEY = _SECRET_KEY.encode()


def _to_utc(dt: datetime) -> datetime:
    """Make a naive datetime (as MongoDB returns) timezone-aware in UTC."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _hash_otp(otp: str) -> str:
    return hmac.new(_OTP_HMAC_KEY, otp.encode(), hashlib.sha256).hexdigest()


def _verify_otp(otp: str, stored_hash: str) -> bool:
    return hmac.compare_digest(_hash_otp(otp), stored_hash)


async def _bcrypt_hash(password: str) -> str:
    loop = asyncio.get_event_loop()
    hashed = await loop.run_in_executor(
        None, bcrypt.hashpw, password.encode(), bcrypt.gensalt(rounds=10)
    )
    return hashed.decode()


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
        try:
            password = _decrypt(body.password)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid request payload.")

        if not _EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Invalid email format.")

        pw_error = _validate_password(password)
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

        otp = str(random.randint(100000, 999999))
        hashed_pw = await _bcrypt_hash(password)
        otp_hash = _hash_otp(otp)
        now = datetime.now(timezone.utc)

        doc = {
            "email": email,
            "name": name,
            "hashed_password": hashed_pw,
            "otp_hash": otp_hash,
            "otp_expiry": now + timedelta(minutes=10),
            "attempts": 0,
            "created_at": now,
        }
        try:
            # replace_one+upsert is atomic — avoids the TOCTOU race of
            # delete_many followed by insert_one under concurrent requests.
            await db.pending_verifications.replace_one({"email": email}, doc, upsert=True)
        except DuplicateKeyError:
            raise HTTPException(
                status_code=409,
                detail="Signup already in progress for this email. Please check your inbox.",
            )

        try:
            send_otp_email(to_email=email, otp=otp, name=name)
        except Exception as exc:
            logger.error("OTP email failed for %s***@%s: %s", email.split('@')[0][:3], email.split('@')[1], exc)
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

        if datetime.now(timezone.utc) > _to_utc(pending["otp_expiry"]):
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

        if not _verify_otp(body.otp, pending["otp_hash"]):
            await db.pending_verifications.update_one(
                {"email": email}, {"$inc": {"attempts": 1}}
            )
            remaining = 4 - pending["attempts"]
            raise HTTPException(
                status_code=400,
                detail=f"Invalid code. {remaining} attempt(s) remaining.",
            )

        user_id = f"user_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc)

        # First user to verify becomes admin — mirrors Microsoft auth first-admin pattern
        admin_count = await db.authorized_users.count_documents({"role": "admin"})
        role = "admin" if admin_count == 0 else "rep"

        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": pending["name"],
            "hashed_password": pending["hashed_password"],
            "auth_method": "email",
            "is_verified": True,
            "role": role,
            "created_at": now,
            "last_login": now,
        })

        if not await db.authorized_users.find_one({"email": email}):
            await db.authorized_users.insert_one({
                "email": email,
                "display_name": pending["name"],
                "role": role,
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

        elapsed = (datetime.now(timezone.utc) - _to_utc(pending["created_at"])).total_seconds()
        if elapsed < 60:
            wait = int(60 - elapsed)
            raise HTTPException(
                status_code=429,
                detail=f"Please wait {wait} seconds before requesting a new code.",
            )

        otp = str(random.randint(100000, 999999))
        otp_hash = _hash_otp(otp)
        now = datetime.now(timezone.utc)

        await db.pending_verifications.update_one(
            {"email": email},
            {"$set": {
                "otp_hash": otp_hash,
                "otp_expiry": now + timedelta(minutes=10),
                # intentionally NOT resetting attempts — a new OTP invalidates
                # old guesses but the attempt budget carries over to prevent
                # resend being used to bypass the 5-attempt lockout.
                "created_at": now,
            }},
        )

        try:
            send_otp_email(to_email=email, otp=otp, name=pending.get("name", ""))
        except Exception as exc:
            logger.error("OTP resend failed for %s***@%s: %s", email.split('@')[0][:3], email.split('@')[1], exc)
            raise HTTPException(
                status_code=500,
                detail="Failed to send email. Check SMTP configuration.",
            )

        return {"success": True, "data": {}, "error": None}

    return router
