import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { derivePasswordKey } from '../public/auth.js';

test('browser Web Crypto matches the frozen KDF for Unicode passwords and rejects invalid inputs', async () => {
  const password = 'eight 🦌 characters';
  const salt = '0123456789abcdef0123456789abcdef';
  assert.equal(await derivePasswordKey(password, salt), pbkdf2Sync(password, salt, 600_000, 32, 'sha256').toString('hex'));
  await assert.rejects(derivePasswordKey('short', salt));
  await assert.rejects(derivePasswordKey(password, 'invalid'));
  await assert.rejects(derivePasswordKey('🦌'.repeat(33), salt));
});
