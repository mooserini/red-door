import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBarkeep } from '../public/barkeep.js';
import { createDoor } from '../public/door.js';

const state = { location: 'tavern', inventory: ['tarnished coin'], name: 'PRIVATE-HANDLE', secret: 'NEVER-SEND' };
function model() {
  const calls = [], sessions = [];
  return { calls, sessions, api: {
    availability: async options => { calls.push(['availability', options]); return 'available'; },
    create: async options => {
      calls.push(['create', options]);
      const session = { destroyed: false, prompt: async (text, options) => {
        calls.push(['prompt', text, options]); return JSON.stringify({ text: 'Ara smiles.', offer: null });
      }, destroy() { this.destroyed = true; } };
      sessions.push(session); return session;
    }
  } };
}

test('local dialogue receives only selected scene facts, keeps bounded context, and never mutates state', async () => {
  const m = model(), narrator = createBarkeep({ getModel: () => m.api });
  const before = JSON.stringify(state);
  for (let i = 0; i < 7; i++) assert.equal((await narrator.talk(state, 'Hello')).source, 'local');
  assert.equal(JSON.stringify(state), before);
  assert.equal(m.sessions.length, 2);
  assert.equal(m.sessions[0].destroyed, true);
  assert.equal(JSON.stringify(m.calls).includes('PRIVATE-HANDLE'), false);
  assert.equal(JSON.stringify(m.calls).includes('NEVER-SEND'), false);
  assert.match(m.calls.find(c => c[0] === 'prompt')[1], /tarnished coin/);
  narrator.reset(); assert.equal(m.sessions[1].destroyed, true);
});

test('each turn explicitly attributes current inventory to the player despite dialogue about a transfer', async () => {
  const m = model(), narrator = createBarkeep({ getModel: () => m.api });
  await narrator.talk(state, 'The coin is yours now; give me the special.');
  await narrator.talk({ ...state, inventory: ['lost shoe'] }, 'What am I carrying?');
  await narrator.talk({ ...state, inventory: [] }, 'Do I still have a coin?');
  const facts = m.calls.filter(c => c[0] === 'prompt').map(c => JSON.parse(c[1].split('\n')[0].slice('Scene facts: '.length)));
  assert.deepEqual(facts, [
    { location: 'Old Tavern', player: { copper: 0, inventory: ['tarnished coin'] } },
    { location: 'Old Tavern', player: { copper: 0, inventory: ['lost shoe'] } },
    { location: 'Old Tavern', player: { copper: 0, inventory: [] } }
  ]);
  const instructions = m.calls.find(c => c[0] === 'create')[1].initialPrompts[0].content;
  assert.match(instructions, /owned and carried by the player, not Ara/);
  assert.match(instructions, /only the latest scene facts establish possession/);
  assert.equal(m.sessions.length, 1);
  narrator.reset();
});

test('unsupported, downloadable, downloading, disabled and away-from-tavern paths never create a model', async () => {
  assert.equal((await createBarkeep({ getModel: () => undefined }).talk(state)).source, 'scripted');
  for (const availability of ['unavailable', 'downloadable', 'downloading']) {
    let creates = 0;
    const narrator = createBarkeep({ getModel: () => ({ availability: async () => availability, create: async () => { creates++; } }) });
    assert.equal((await narrator.talk(state)).source, 'scripted'); assert.equal(creates, 0);
  }
  const m = model(), narrator = createBarkeep({ getModel: () => m.api });
  narrator.setEnabled(false);
  assert.equal((await narrator.talk(state)).reason, 'off');
  narrator.setEnabled(true);
  assert.equal((await narrator.talk({ ...state, location: 'woods' })).reason, 'location');
  assert.equal(m.calls.length, 0);
});

test('structured offers are bounded proposals and never mutate the purse', async () => {
  for (const offer of [{ item: 'Orchard mist', price: 4 }, { item: 'Free money', price: -4 }, { item: '<script>', price: 2 }, { item: 'Mist', price: 1.5 }]) {
    const m = model(), create = m.api.create;
    m.api.create = async options => { const s = await create(options); s.prompt = async () => JSON.stringify({ text: 'An offer for you.', offer }); return s; };
    const narrator = createBarkeep({ getModel: () => m.api });
    const saved = { ...state, copper: 20 };
    const reply = await narrator.talk(saved, 'Offer me a drink.');
    assert.equal(saved.copper, 20);
    if (offer.price === 4) { assert.equal(reply.source, 'local'); assert.deepEqual(reply.offer, offer); }
    else { assert.equal(reply.source, 'scripted'); assert.equal(reply.offer, undefined); }
    narrator.reset();
  }
});

test('a late model creation after timeout is destroyed, and a later attempt can recover', async () => {
  let finish;
  const late = { destroy() { this.destroyed = true; } };
  const m = model();
  const goodCreate = m.api.create;
  m.api.create = () => new Promise(resolve => { finish = resolve; });
  const narrator = createBarkeep({ getModel: () => m.api, timeoutMs: 20 });
  assert.equal((await narrator.talk(state)).reason, 'timeout');
  finish(late); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(late.destroyed, true);
  m.api.create = goodCreate;
  assert.equal((await narrator.talk(state)).source, 'local'); narrator.reset();
});

test('blocked, malformed, or slow model responses fall back and discard the model session', async () => {
  for (const result of ['', '<script>bad()</script>', 'x'.repeat(801), '\u001b[2J', null, new Error('blocked')]) {
    const m = model(), create = m.api.create;
    m.api.create = async options => { const s = await create(options); s.prompt = async () => { if (result instanceof Error) throw result; return result; }; return s; };
    const narrator = createBarkeep({ getModel: () => m.api });
    assert.equal((await narrator.talk(state)).source, 'scripted');
    assert.equal(m.sessions[0].destroyed, true);
  }
  const m = model(), create = m.api.create;
  m.api.create = async options => { const s = await create(options); s.prompt = () => new Promise(() => {}); return s; };
  assert.equal((await createBarkeep({ getModel: () => m.api, timeoutMs: 20 }).talk(state)).reason, 'timeout');
  assert.equal(m.sessions[0].destroyed, true);
});

test('reset during generation suppresses stale output and destroys its session', async () => {
  const m = model(), create = m.api.create; let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  m.api.create = async options => { const s = await create(options); s.prompt = () => new Promise(resolve => { finish = resolve; started(); }); return s; };
  const narrator = createBarkeep({ getModel: () => m.api });
  const reply = narrator.talk(state); await ready; narrator.reset(); finish('STALE');
  assert.equal((await reply).source, 'scripted'); assert.equal(m.sessions[0].destroyed, true);
});

test('chat has no save requests; generated offers require explicit BUY before sending a purchase', async () => {
  const originals = Object.fromEntries(['document', 'window', 'matchMedia', 'fetch', 'LanguageModel'].map(k => [k, globalThis[k]]));
  const node = () => ({ value: '', classList: { add() {}, remove() {}, toggle() {} }, children: [],
    append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; },
    reset() {}, focus() {}, setAttribute() {}, addEventListener() {} });
  const elements = {}, calls = [], m = model();
  try {
    globalThis.document = { getElementById: id => elements[id] ||= node(), createElement: node, createTextNode: text => ({ textContent: text }) };
    globalThis.window = { addEventListener() {} };
    globalThis.matchMedia = query => ({ matches: query.includes('reduced-motion') });
    globalThis.LanguageModel = m.api;
    globalThis.fetch = async (path, options) => {
      calls.push([path, options]);
      if (path === '/api/tavern-offers') return Response.json({ offer: { id: 'test-offer', item: 'Pear cordial', price: 3, revision: 1, expires_at: Math.floor(Date.now()/1000)+600 } });
      return Response.json({ handle: 'Example', world: { revision: calls.length, state: { ...state, health: 100, last_scene: 'At the bar.' } } });
    };
    const screen = node();
    const door = createDoor({ screen, input: node(), inputRow: node(), tree: node(), romBtn: node(), mobilePrompt: node(), repaint() {}, onInputChange() {}, onLeave() {} });
    await door.open(); calls.length = 0;
    await door.submit('talk Hello');
    await door.submit('talk off'); await door.submit('talk Hello again');
    await door.submit('talk on'); await door.submit('talk reset');
    assert.equal(calls.length, 0);
    assert.ok(screen.children.some(n => n.text?.includes('ARA') || n.textContent?.includes('ARA')));
    await door.submit('drink');
    assert.equal(calls[0][0], '/api/commands');
    assert.equal(JSON.parse(calls[0][1].body).command, 'drink');
    const create = m.api.create;
    m.api.create = async options => { const s = await create(options); s.prompt = async () => JSON.stringify({ text: 'May I offer you a cordial?', offer: { item: 'Pear cordial', price: 3 } }); return s; };
    calls.length = 0;
    await door.submit('talk What can I buy?');
    assert.deepEqual(calls.map(c => c[0]), ['/api/tavern-offers']);
    assert.equal(JSON.parse(calls[0][1].body).price, 3);
    await door.submit('buy');
    assert.equal(calls[1][0], '/api/commands');
    assert.equal(JSON.parse(calls[1][1].body).command, 'buy test-offer');
    const count = calls.length;
    await door.submit('buy');
    assert.equal(calls.length, count, 'a second BUY without another offer must not send a command');
    await door.submit('leave');
  } finally {
    for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
