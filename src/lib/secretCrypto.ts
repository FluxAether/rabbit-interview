// Lightweight reversible encoding for secrets at rest in SQLite.
// Not a substitute for OS keychain; stops casual plaintext inspection of the DB.
// ponytail: app-static XOR mask, upgrade to Keychain/user passphrase if threat model hardens
const SECRET_PREFIX = "ri1:";
const APP_SECRET_SEED = "rabbit-interview/secrets/v1";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function deriveMask(length: number): Uint8Array {
  const mask = new Uint8Array(length);
  let state = 2166136261;
  for (let i = 0; i < APP_SECRET_SEED.length; i += 1) {
    state ^= APP_SECRET_SEED.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    mask[i] = state & 0xff;
  }
  return mask;
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const input = new TextEncoder().encode(plain);
  const mask = deriveMask(input.length);
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = input[i] ^ mask[i];
  return `${SECRET_PREFIX}${toBase64(out)}`;
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(SECRET_PREFIX)) {
    // Backward-compatible with any accidental plaintext rows.
    return stored;
  }
  try {
    const encoded = stored.slice(SECRET_PREFIX.length);
    const input = fromBase64(encoded);
    const mask = deriveMask(input.length);
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i += 1) out[i] = input[i] ^ mask[i];
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(SECRET_PREFIX));
}
