"""
Shared AES-GCM payload decryption for fields encrypted by the frontend.
Falls back gracefully to plaintext if PAYLOAD_ENCRYPTION_KEY is not set
or if decryption fails (e.g. during key rotation).
"""
import os
import base64
import logging

logger = logging.getLogger(__name__)

_KEY_B64 = os.environ.get("PAYLOAD_ENCRYPTION_KEY", "")


def decrypt_field(value: str) -> str:
    if not _KEY_B64 or not value:
        return value
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        data = base64.b64decode(value)
        key = base64.b64decode(_KEY_B64)
        iv, ciphertext = data[:12], data[12:]
        return AESGCM(key).decrypt(iv, ciphertext, None).decode()
    except Exception:
        return value
