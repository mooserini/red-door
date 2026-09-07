import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { derivePasswordKey } from '../public/auth.js';

let mf, db;
const origin = 'https://door.test';
const password = 'disposable-test-password';
let ip = 0;
before(async () => {
  mf = new Miniflare({ workers: [{ config: {
    name: 'red-door', type: 'worker', compatibilityDate: '2026-09-07', compatibilityFlags: ['nodejs_compat'],
    manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: await readFile('dist/worker.js', 'utf8') } } },
    env: { DB: { type: 'd1', name: 'test-red-door', id: 'test-red-door' }, STATIC: { type: 'r2', name: 'test-static' } }
  } }] });
  db = await mf.getD1Database('DB');
  const sql = (await readFile('migrations/0001_red_door.sql', 'utf8')).replace(/--[^\n]*/g, '');
  for (const statement of sql.split(/;\s*(?=CREATE|PRAGMA|$)/).filter(v => v.trim())) await db.prepare(statement).run();
  const bucket = await mf.getR2Bucket('STATIC');
  await bucket.put('index.html', '<!doctype html><title>Mirror</title>', { httpMetadata: { contentType: 'text/html' } });
});
after(async () => { await mf?.dispose(); });

async function request(path, { data, cookie, method, requestOrigin = origin, address, raw = false } = {}) {
  if (!raw && ['/api/register', '/api/login'].includes(path) && typeof data?.password === 'string') {
    const params = await request('/api/auth-params', { data: { handle: data.handle }, requestOrigin, address });
    if (params.status !== 200) return params;
    data = { handle: data.handle, salt: params.data.salt, password_key: await derivePasswordKey(data.password, params.data.salt) };
  }
  const headers = { Origin: requestOrigin, 'CF-Connecting-IP': address || `192.0.2.${++ip}` };
  if (cookie) headers.Cookie = cookie;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await mf.dispatchFetch(origin + path, { method: method || (data === undefined ? 'GET' : 'POST'),
    headers, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, headers: response.headers,
    data: response.headers.get('Content-Type')?.includes('json') ? await response.json() : await response.text() };
}
async function register(handle) {
  const result = await request('/api/register', { data: { handle, password } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { ...result, cookie: result.headers.get('Set-Cookie').split(';')[0] };
}
const move = (command, revision = 0, request_id = crypto.randomUUID()) => ({ command, expected_revision: revision, request_id });

test('R2 serves only the allowed static surface; writes require same origin', async () => {
  const page = await request('/'); assert.equal(page.status, 200); assert.match(page.data, /Mirror/);
  assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal((await request('/private.txt')).status, 404);
  assert.equal((await request('/api/world')).status, 401);
  assert.equal((await request('/api/register', { data: { handle: 'CrossSite', password }, requestOrigin: 'https://evil.test' })).status, 403);
});
test('registration hashes passwords, folds handle case, and has no recovery endpoint', async () => {
  const caller = await register('MooseTest');
  assert.match(caller.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const account = await db.prepare('SELECT * FROM accounts WHERE handle_key = ?').bind('moosetest').first();
  assert.notEqual(account.password_hash, password);
  assert.match(account.password_hash, /^client-pbkdf2-sha256-600000-v1:[a-f0-9]{64}$/);
  assert.equal((await request('/api/register', { data: { handle: 'moosetest', password } })).status, 409);
  assert.equal((await request('/api/recover', { data: { handle: 'MooseTest' } })).status, 404);
  const bad = await request('/api/login', { data: { handle: 'MooseTest', password: 'wrong-password' } });
  assert.equal(bad.status, 401);
  const good = await request('/api/login', { data: { handle: 'MOOSETEST', password } }); assert.equal(good.status, 200);
});
test('different handles have independent saves; client replacement state is rejected', async () => {
  const a = await register('CallerA'), b = await register('CallerB');
  const result = await request('/api/commands', { cookie: a.cookie, data: move('woods') });
  assert.equal(result.status, 200); assert.equal(result.data.world.state.location, 'woods_edge');
  const untouched = await request('/api/world', { cookie: b.cookie });
  assert.equal(untouched.data.world.state.location, 'tavern'); assert.equal(untouched.data.world.revision, 0);
  assert.equal((await request('/api/commands', { cookie: a.cookie, data: { ...move('rest', 1), state: { health: 999 } } })).status, 400);
});
test('concurrent identical random commands commit once and return the same outcome', async () => {
  const a = await register('RetryCaller'); const data = move('explore');
  const replies = await Promise.all(Array.from({ length: 5 }, () => request('/api/commands', { cookie: a.cookie, data })));
  for (const reply of replies) { assert.equal(reply.status, 200); assert.deepEqual(reply.data.world, replies[0].data.world); }
  const count = await db.prepare('SELECT count(*) AS n FROM receipts WHERE request_id = ?').bind(data.request_id).first();
  assert.equal(count.n, 1);
  assert.equal((await request('/api/commands', { cookie: a.cookie, data: { ...data, command: 'drink' } })).status, 409);
});
test('different simultaneous moves cannot overwrite each other; status reads the winner', async () => {
  const a = await register('RaceCaller');
  const replies = await Promise.all(['woods', 'drink'].map(command => request('/api/commands', { cookie: a.cookie, data: move(command) })));
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  const state = await request('/api/world', { cookie: a.cookie });
  assert.deepEqual(state.data.world, replies.find(r => r.status === 200).data.world);
});
test('logout revokes the session; logging in from a new session restores the saved game', async () => {
  const a = await register('ReturnCaller');
  const saved = await request('/api/commands', { cookie: a.cookie, data: move('woods') });
  assert.equal((await request('/api/logout', { cookie: a.cookie, data: {} })).status, 200);
  assert.equal((await request('/api/world', { cookie: a.cookie })).status, 401);
  const back = await request('/api/login', { data: { handle: 'ReturnCaller', password } });
  assert.equal(back.status, 200); assert.deepEqual(back.data.world, saved.data.world);
});
test('login attempts are throttled before expensive hashing', async () => {
  await db.prepare('INSERT INTO auth_limits VALUES (?, 8, ?)').bind(
    (await import('node:crypto')).createHash('sha256').update('handle:throttled').digest('hex'), Math.floor(Date.now()/1000)+60).run();
  assert.equal((await request('/api/login', { data: { handle: 'Throttled', password } })).status, 429);
});

test('a leaked database verifier cannot be replayed as a password key; plaintext is rejected', async () => {
  await register('VerifierCaller');
  const a = await db.prepare('SELECT * FROM accounts WHERE handle_key = ?').bind('verifiercaller').first();
  const derived = await derivePasswordKey(password, a.password_salt);
  const stored = a.password_hash.split(':')[1];
  assert.notEqual(stored, derived);
  assert.equal((await request('/api/login', { data: { handle: a.handle, salt: a.password_salt, password_key: stored } })).status, 401);
  assert.equal((await request('/api/login', { raw: true, data: { handle: a.handle, password } })).status, 400);
  assert.equal((await request('/api/login', { data: { handle: a.handle, salt: '0'.repeat(32), password_key: derived } })).status, 401);
  assert.equal((await request('/api/login', { data: { handle: a.handle, password_key: 'short', salt: a.password_salt } })).status, 400);
});
test('frozen-preview accounts upgrade their verifier while retaining their saved world', async () => {
  const caller = await register('LegacyCaller');
  const saved = await request('/api/commands', { cookie: caller.cookie, data: move('woods') });
  const a = await db.prepare('SELECT * FROM accounts WHERE handle_key = ?').bind('legacycaller').first();
  const legacy = 'pbkdf2-sha256-600000:' + await derivePasswordKey(password, a.password_salt);
  await db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').bind(legacy, a.id).run();
  const back = await request('/api/login', { data: { handle: 'LEGACYCALLER', password } });
  assert.equal(back.status, 200); assert.deepEqual(back.data.world, saved.data.world);
  const upgraded = await db.prepare('SELECT password_hash FROM accounts WHERE id = ?').bind(a.id).first();
  assert.match(upgraded.password_hash, /^client-pbkdf2-sha256-600000-v1:/);
});
