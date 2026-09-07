import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { advance, initialState } from './game';

const COOKIE = '__Host-reddoor';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const HASH_SCHEME = 'client-pbkdf2-sha256-600000-v1:';
const LEGACY_SCHEME = 'pbkdf2-sha256-600000:';
const verifier = (salt: string, key: string) => sha(`reddoor-login-v1:${salt}:${key}`);
type WorldRow = { state_json: string; revision: number; receipt_hash: string };
type ReceiptRow = WorldRow & { request_id: string; command: string; expected_revision: number; created_at: number };
type AccountRow = { id: string; handle: string; password_hash: string; password_salt: string };
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const seconds = () => Math.floor(Date.now() / 1000);
const worldJSON = (row: WorldRow) => ({ state: JSON.parse(row.state_json), revision: row.revision, receipt_hash: row.receipt_hash });
function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
function cookie(token: string, clear = false) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}`;
}
function tokenFrom(request: Request) {
  return (request.headers.get('Cookie') || '').split(';').map(v => v.trim())
    .find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
}
async function currentAccount(request: Request, env: Env) {
  const token = tokenFrom(request);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Log in to open your saved game.');
  const account = await env.DB.prepare(`SELECT a.id, a.handle FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(sha(token), seconds()).first<{ id: string; handle: string }>();
  if (!account) throw new HttpError(401, 'Your session has ended. Log in again.');
  return account;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, 'Use the Red Door page.');
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new HttpError(415, 'JSON is required.');
  // Bound the actual stream as well as Content-Length, including chunked bodies.
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'A request is required.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) { await reader.cancel(); throw new HttpError(413, 'Keep the request short.'); }
    chunks.push(value);
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new HttpError(400, 'Invalid request.'); }
}
function callerHandle(data: Record<string, unknown>) {
  const { handle } = data;
  if (typeof handle !== 'string' || !/^[A-Za-z0-9_-]{3,20}$/.test(handle))
    throw new HttpError(400, 'Handle: 3–20 letters, numbers, underscores or hyphens.');
  return { handle, key: handle.toLowerCase() };
}
function credentials(data: Record<string, unknown>) {
  const caller = callerHandle(data);
  const { password_key, salt } = data;
  // This endpoint never accepts plaintext passwords or a stored verifier.
  if ('password' in data || typeof password_key !== 'string' || !/^[a-f0-9]{64}$/.test(password_key) ||
      typeof salt !== 'string' || !/^[a-f0-9]{32}$/.test(salt))
    throw new HttpError(400, 'Reload the page and enter your password again.');
  return { ...caller, passwordKey: password_key, salt };
}
async function authParams(request: Request, env: Env, data: Record<string, unknown>) {
  const { key } = callerHandle(data);
  await rateLimit(request, env, key);
  const account = await env.DB.prepare('SELECT password_salt FROM accounts WHERE handle_key = ?')
    .bind(key).first<{ password_salt: string }>();
  // Salt is public. Unknown callers receive fresh random salt without reserving a handle.
  return json({ salt: account?.password_salt || randomBytes(16).toString('hex') });
}
async function rateLimit(request: Request, env: Env, handle: string) {
  const now = seconds();
  // The edge supplies CF-Connecting-IP. Local tests share a loopback bucket.
  const keys = ['ip:' + (request.headers.get('CF-Connecting-IP') || 'local'), 'handle:' + handle];
  for (const key of keys) {
    const row = await env.DB.prepare(`INSERT INTO auth_limits(key, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
        expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
      RETURNING attempts`).bind(sha(key), now + 60, now, now).first<{ attempts: number }>();
    if (!row || row.attempts > (key.startsWith('ip:') ? 20 : 8)) throw new HttpError(429, 'Too many attempts. Give the line a minute.');
  }
}
async function login(request: Request, env: Env, data: Record<string, unknown>, register: boolean) {
  const { handle, key, passwordKey, salt } = credentials(data);
  await rateLimit(request, env, key);
  let account = await env.DB.prepare('SELECT id, handle, password_hash, password_salt FROM accounts WHERE handle_key = ?')
    .bind(key).first<AccountRow>();
  const now = seconds();
  const token = randomBytes(32).toString('hex');
  const session = (id: string) => env.DB.prepare('INSERT INTO sessions(token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(sha(token), id, now + SESSION_SECONDS);
  if (register) {
    if (account) throw new HttpError(409, 'That handle is already taken.');
    const passwordHash = HASH_SCHEME + verifier(salt, passwordKey);
    const id = crypto.randomUUID();
    const state = JSON.stringify(initialState(handle));
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO accounts(id, handle, handle_key, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, handle, key, passwordHash, salt, now),
        env.DB.prepare('INSERT INTO worlds(account_id, state_json, revision, receipt_hash) VALUES (?, ?, 0, ?)')
          .bind(id, state, sha(state)),
        session(id)
      ]);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, 'That handle is already taken.');
      throw error;
    }
    account = { id, handle, password_hash: passwordHash, password_salt: salt };
  } else {
    const legacy = account?.password_hash.startsWith(LEGACY_SCHEME);
    const stored = legacy ? verifier(account!.password_salt, account!.password_hash.slice(LEGACY_SCHEME.length))
      : account?.password_hash.startsWith(HASH_SCHEME) ? account.password_hash.slice(HASH_SCHEME.length) : '0'.repeat(64);
    const actual = Buffer.from(verifier(salt, passwordKey), 'hex');
    const expected = Buffer.from(stored, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(actual, expected) || !account || salt !== account.password_salt)
      throw new HttpError(401, 'Handle or password not recognized.');
    // Preserve callers created in the frozen local preview, without running its old server KDF.
    if (legacy) await env.DB.prepare('UPDATE accounts SET password_hash = ? WHERE id = ? AND password_hash = ?')
      .bind(HASH_SCHEME + stored, account.id, account.password_hash).run();
    await session(account.id).run();
  }
  // Rotate a previous browser session, without invalidating other devices.
  if (tokenFrom(request)) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(sha(tokenFrom(request))).run();
  const world = await env.DB.prepare('SELECT state_json, revision, receipt_hash FROM worlds WHERE account_id = ?')
    .bind(account.id).first<WorldRow>();
  if (!world) throw new Error('missing_world');
  return json({ handle: account.handle, world: worldJSON(world) }, register ? 201 : 200, { 'Set-Cookie': cookie(token) });
}

async function command(request: Request, env: Env, data: Record<string, unknown>) {
  const account = await currentAccount(request, env);
  if ('state' in data || 'account_id' in data) throw new HttpError(400, 'Send a command; the world keeps its own ledger.');
  const requestId = data.request_id;
  const revision = data.expected_revision;
  if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId) ||
    typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 ||
    typeof data.command !== 'string' || data.command.length > 128)
    throw new HttpError(400, 'Invalid command request.');
  const cmd = data.command.trim().toLowerCase();
  const prior = () => env.DB.prepare('SELECT * FROM receipts WHERE account_id = ? AND request_id = ?')
    .bind(account.id, requestId).first<ReceiptRow>();
  const replay = (receipt: ReceiptRow) => {
    if (receipt.command !== cmd || receipt.expected_revision !== revision) throw new HttpError(409, 'That request ID belongs to another command.');
    return json({ world: worldJSON(receipt), request_id: requestId, replayed: true });
  };
  const existing = await prior();
  if (existing) return replay(existing);
  const world = await env.DB.prepare('SELECT state_json, revision, receipt_hash FROM worlds WHERE account_id = ?')
    .bind(account.id).first<WorldRow>();
  if (!world) throw new Error('missing_world');
  if (world.revision !== revision) throw new HttpError(409, 'Another session moved first. Read STATUS, then choose your next move.');
  let next;
  try { next = advance(JSON.parse(world.state_json), cmd); }
  catch { throw new HttpError(400, 'Try tavern, woods, explore, search, rest or drink.'); }
  const state = JSON.stringify(next);
  const created = seconds();
  const receiptHash = sha(JSON.stringify([account.id, requestId, cmd, revision, state, world.receipt_hash, created]));
  try {
    await env.DB.prepare(`INSERT INTO receipts(account_id, request_id, command, expected_revision, revision,
      state_json, previous_hash, receipt_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(account.id, requestId, cmd, revision, revision + 1, state, world.receipt_hash, receiptHash, created).run();
  } catch (error) {
    // A concurrent identical retry returns the winning receipt, including its random outcome.
    const winner = await prior();
    if (winner) return replay(winner);
    if (String(error).includes('revision_conflict') || String(error).includes('UNIQUE'))
      throw new HttpError(409, 'Another session moved first. Read STATUS, then choose your next move.');
    throw error;
  }
  return json({ world: worldJSON({ state_json: state, revision: revision + 1, receipt_hash: receiptHash }), request_id: requestId });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET' && url.pathname === '/api/world') {
      const account = await currentAccount(request, env);
      const row = await env.DB.prepare('SELECT state_json, revision, receipt_hash FROM worlds WHERE account_id = ?')
        .bind(account.id).first<WorldRow>();
      if (!row) throw new Error('missing_world');
      return json({ handle: account.handle, world: worldJSON(row) });
    }
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const data = await body(request);
    if (url.pathname === '/api/auth-params') return authParams(request, env, data);
    if (url.pathname === '/api/register') return login(request, env, data, true);
    if (url.pathname === '/api/login') return login(request, env, data, false);
    if (url.pathname === '/api/logout') {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(sha(tokenFrom(request))).run();
      return json({ signed_out: true }, 200, { 'Set-Cookie': cookie('', true) });
    }
    if (url.pathname === '/api/commands') return command(request, env, data);
    throw new HttpError(404, 'Not found.');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
  const key = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  // Serve only this release's known public surface; no bucket listing or arbitrary keys.
  if (!['index.html', 'mirror.css', 'mirror.js', 'door.js', 'pacing.js', 'auth.js',
    'assets/projects-core.v1.js', 'assets/projects.json', 'assets/fonts/Ac437_ATT_PC6300.ttf', 'assets/linktree-qr-400.png'].includes(key))
    throw new HttpError(404, 'Not found.');
  const object = await env.STATIC.get(key);
  if (!object) throw new HttpError(404, 'Not found.');
  const headers = new Headers(); object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  if (request.headers.get('If-None-Match') === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try { response = await route(request, env); }
    catch (error) {
      if (error instanceof HttpError) response = json({ error: error.message }, error.status);
      else {
        // No credentials, bodies, cookies, handles, or engine state in logs.
        console.error(JSON.stringify({ event: 'request_failed', path: new URL(request.url).pathname }));
        response = json({ error: 'The line dropped. RETRY an unconfirmed move, or read STATUS.' }, 500);
      }
    }
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'same-origin');
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    return response;
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(seconds()),
      env.DB.prepare('DELETE FROM auth_limits WHERE expires_at <= ?').bind(seconds())
    ]);
  }
} satisfies ExportedHandler<Env>;
