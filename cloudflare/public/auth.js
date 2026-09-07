// Password stretching runs on the caller's device using native Web Crypto.
// The derived key is a login credential: never log it, cache it, or put it in a URL.
export async function derivePasswordKey(password, salt) {
  const encoder = new TextEncoder();
  if (typeof password !== 'string' || password.length < 8 || encoder.encode(password).length > 128)
    throw new Error('Use at least 8 characters and no more than 128 bytes.');
  if (typeof salt !== 'string' || !/^[a-f0-9]{32}$/.test(salt)) throw new Error('Invalid login response. Reload and try again.');
  if (!globalThis.crypto?.subtle) throw new Error('Open this page over HTTPS to log in.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  // Encode the hexadecimal salt as UTF-8, matching the frozen preview's KDF.
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt),
    iterations: 600_000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
}
