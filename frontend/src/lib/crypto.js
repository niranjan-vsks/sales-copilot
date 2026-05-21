/**
 * AES-GCM payload encryption using the browser's native Web Crypto API.
 * The same key must be set as PAYLOAD_ENCRYPTION_KEY on the backend.
 * Falls back to plaintext if REACT_APP_PAYLOAD_ENCRYPTION_KEY is not configured.
 * Key is not cached — importKey is fast for a 256-bit raw key and caching
 * causes stale-key failures across deploys without a page refresh.
 */

const KEY_B64 = process.env.REACT_APP_PAYLOAD_ENCRYPTION_KEY;

async function _getKey() {
  if (!KEY_B64) return null;
  const raw = Uint8Array.from(atob(KEY_B64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM' }, false, ['encrypt']
  );
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
