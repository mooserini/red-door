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
  for (const file of ['0001_red_door.sql', '0002_tavern_offers.sql', '0003_item_types.sql']) {
    const sql = (await readFile('migrations/' + file, 'utf8')).replace(/--[^\n]*/g, '');
    for (const statement of sql.split(/;\s*(?=CREATE|PRAGMA|ALTER|$)/).filter(v => v.trim())) await db.prepare(statement).run();
  }
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
  const replies = await Promise.all(['woods', 'rest'].map(command => request('/api/commands', { cookie: a.cookie, data: move(command) })));
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

async function funded(handle) {
  const a = await register(handle);
  await db.prepare("UPDATE worlds SET state_json=json_set(state_json, '$.copper', 20) WHERE account_id=(SELECT id FROM accounts WHERE handle_key=?)").bind(handle.toLowerCase()).run();
  return a;
}
const quote = (a, item='Whispering pear cider', price=3, revision=0, kind='drink') => request('/api/tavern-offers', {
  cookie: a.cookie, data: { item, price, kind, expected_revision: revision }
});
test('invented offer changes no balance; accepting spends once and persists across login', async () => {
  const a = await funded('BuyerOne');
  const q = await quote(a); assert.equal(q.status, 200);
  assert.equal((await request('/api/world', { cookie: a.cookie })).data.world.state.copper, 20);
  const purchase = move('buy ' + q.data.offer.id);
  const results = await Promise.all(Array.from({length: 4}, () => request('/api/commands', {cookie:a.cookie, data:purchase})));
  for (const r of results) { assert.equal(r.status, 200); assert.equal(r.data.world.state.copper, 17); assert.deepEqual(r.data.world.state.inventory, ['Whispering pear cider']); }
  assert.equal((await request('/api/commands', { cookie:a.cookie, data:move(purchase.command,1) })).status,409);
  const back = await request('/api/login', {data:{handle:'BuyerOne',password}});
  assert.equal(back.data.world.state.copper,17);
  assert.equal(back.data.world.revision,1);
});
test('invalid prices, forged offers and other callers offers cannot spend or credit money', async () => {
  const a=await funded('BuyerTwo'), b=await funded('BuyerThree');
  for(const price of [-1,0,1.5,21,'3',null]) assert.equal((await quote(a,'Mist broth',price)).status,400);
  assert.equal((await quote(a,'<script>')).status,400);
  const q=await quote(a);
  assert.equal((await request('/api/commands',{cookie:b.cookie,data:move('buy '+q.data.offer.id)})).status,409);
  assert.equal((await request('/api/commands',{cookie:a.cookie,data:move('buy '+crypto.randomUUID())})).status,409);
  const valid=await request('/api/commands',{cookie:a.cookie,data:{...move('buy '+q.data.offer.id),price:-100,item:'Free money'}});
  assert.equal(valid.status,200); assert.equal(valid.data.world.state.copper,17);
  assert.deepEqual(valid.data.world.state.inventory,['Whispering pear cider']);
});
test('replacement, expiration, movement and insufficient funds reject a purchase without a debit', async () => {
  const a=await funded('BuyerFour');
  const old=await quote(a), fresh=await quote(a,'Juniper cordial',20);
  assert.equal((await request('/api/commands',{cookie:a.cookie,data:move('buy '+old.data.offer.id)})).status,409);
  const bought=await request('/api/commands',{cookie:a.cookie,data:move('buy '+fresh.data.offer.id)});
  assert.equal(bought.data.world.state.copper,0);
  const poor=await quote(a,'Mist broth',1,1);
  const denied=await request('/api/commands',{cookie:a.cookie,data:move('buy '+poor.data.offer.id,1)});
  assert.equal(denied.status,400);
  assert.equal((await request('/api/world',{cookie:a.cookie})).data.world.revision,1);
  await db.prepare('UPDATE tavern_offers SET expires_at=0 WHERE id=?').bind(poor.data.offer.id).run();
  assert.equal((await request('/api/commands',{cookie:a.cookie,data:move('buy '+poor.data.offer.id,1)})).status,409);
  const stale=await quote(a,'Nettle soup',1,1);
  await request('/api/commands',{cookie:a.cookie,data:move('woods',1)});
  assert.equal((await request('/api/commands',{cookie:a.cookie,data:move('buy '+stale.data.offer.id,2)})).status,409);
  assert.equal((await quote(a,'Nettle soup',1,2)).status,400);
});
test('two different purchase requests racing cannot double-spend', async () => {
  const a=await funded('BuyerRace'), q=await quote(a,'Hearth tonic',4);
  const results=await Promise.all([1,2].map(()=>request('/api/commands',{cookie:a.cookie,data:move('buy '+q.data.offer.id)})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const saved=await request('/api/world',{cookie:a.cookie});
  assert.equal(saved.data.world.state.copper,16); assert.equal(saved.data.world.state.inventory.length,1);
});

test('typed consumption removes exactly one serving, preserves money and health, and replays once', async () => {
  const a=await funded('ConsumeCaller');
  const first=await quote(a,"Rain's Ale",3,0,'drink');
  await request('/api/commands',{cookie:a.cookie,data:move('buy '+first.data.offer.id)});
  const second=await quote(a,"Rain's Ale",3,1,'drink');
  await request('/api/commands',{cookie:a.cookie,data:move('buy '+second.data.offer.id,1)});
  const data=move("drink rain's ale",2);
  const replies=await Promise.all([1,2,3].map(()=>request('/api/commands',{cookie:a.cookie,data})));
  for(const r of replies) {
    assert.equal(r.status,200); assert.deepEqual(r.data.world.state.inventory,["Rain's Ale"]);
    assert.equal(r.data.world.state.copper,14); assert.equal(r.data.world.state.health,100);
  }
  const final=await request('/api/commands',{cookie:a.cookie,data:move("use rain's ale",3)});
  assert.equal(final.status,200); assert.deepEqual(final.data.world.state.inventory,[]);
  assert.deepEqual(final.data.world.state.itemTypes,{});
  assert.equal((await request('/api/commands',{cookie:a.cookie,data:move("drink rain's ale",4)})).status,400);
  const back=await request('/api/login',{data:{handle:'ConsumeCaller',password}});
  assert.equal(back.data.world.revision,4); assert.deepEqual(back.data.world.state.inventory,[]);
});
test('actions reject wrong types and bare verbs; food consumption works without changing location', async () => {
  const a=await funded('FoodCaller'), q=await quote(a,'Lantern Pie',5,0,'food');
  await request('/api/commands',{cookie:a.cookie,data:move('buy '+q.data.offer.id)});
  for(const command of ['drink lantern pie','drink','eat','use','eat missing food']) {
    const r=await request('/api/commands',{cookie:a.cookie,data:move(command,1)});
    assert.equal(r.status,400); assert.match(r.data.error,/consume|cannot|do not have/);
  }
  await request('/api/commands',{cookie:a.cookie,data:move('woods',1)});
  const r=await request('/api/commands',{cookie:a.cookie,data:move('eat LANTERN PIE',2)});
  assert.equal(r.status,200); assert.deepEqual(r.data.world.state.inventory,[]);
  assert.equal(r.data.world.state.location,'woods_edge'); assert.equal(r.data.world.state.copper,15);
});
test('legacy items are never classified from their names and arbitrary type/effect requests have no authority', async () => {
  const a=await funded('LegacyItemCaller');
  for(const kind of ['healing',[],['food'],{},3]) assert.equal((await quote(a,'Mystery',2,0,kind)).status,400);
  const legacy=await request('/api/tavern-offers',{cookie:a.cookie,data:{item:'Very Drinkable Ale',price:2,expected_revision:0}});
  await request('/api/commands',{cookie:a.cookie,data:move('buy '+legacy.data.offer.id)});
  const invalid=await request('/api/commands',{cookie:a.cookie,data:{...move('drink very drinkable ale',1),kind:'drink',effects:{health:999}}});
  assert.equal(invalid.status,400); assert.match(invalid.data.error,/no supported use/);
  const contradictory=await quote(a,'Very Drinkable Ale',2,1,'drink');
  assert.equal((await request('/api/commands',{cookie:a.cookie,data:move('buy '+contradictory.data.offer.id,1)})).status,400);
  const saved=await request('/api/world',{cookie:a.cookie});
  assert.equal(saved.data.world.revision,1); assert.equal(saved.data.world.state.copper,18);
  assert.deepEqual(saved.data.world.state.inventory,['Very Drinkable Ale']);
});
