/**
 * AES-GCM payload encryption using the browser's native Web Crypto API.
 * The same key must be set as PAYLOAD_ENCRYPTION_KEY on the backend.
 * Falls back to plaintext if REACT_APP_PAYLOAD_ENCRYPTION_KEY is not configured.
 */

const KEY_B64 = process.env.REACT_APP_PAYLOAD_ENCRYPTION_KEY;
let _cachedKey = null;

async function _getKey() {
  if (_cachedKey) return _cachedKey;
  if (!KEY_B64) return null;
  const raw = Uint8Array.from(atob(KEY_B64), c => c.charCodeAt(0));
  _cachedKey = await crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM' }, false, ['encrypt']
  );
  return _cachedKey;
}

export async function encryptField(plaintext) {
  if (!plaintext) return plaintext;
  const key = await _getKey();
  if (!key) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...combined));
}
