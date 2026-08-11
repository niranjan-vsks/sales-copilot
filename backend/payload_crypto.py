"""
Shared AES-GCM payload decryption for fields encrypted by the frontend.
- If PAYLOAD_ENCRYPTION_KEY is not set: returns value as-is (plaintext mode).
- If key is set but decryption fails: raises ValueError — callers must handle
  this explicitly. Silent fallback would pass raw ciphertext to bcrypt, making
  key misconfiguration completely invisible.
"""
import os
import base64
import logging

logger = logging.getLogger(__name__)

_KEY_B64 = os.environ.get("PAYLOAD_ENCRYPTION_KEY", "")


def decrypt_field(value: str) -> str:
    if not _KEY_B64 or not value:
        return value  # encryption not configured — plaintext mode
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        data = base64.b64decode(value)
        key = base64.b64decode(_KEY_B64)
        iv, ciphertext = data[:12], data[12:]
        return AESGCM(key).decrypt(iv, ciphertext, None).decode()
    except Exception as exc:
        logger.error("decrypt_field failed — key mismatch or corrupt payload: %s", exc)
        raise ValueError("Payload decryption failed") from exc
