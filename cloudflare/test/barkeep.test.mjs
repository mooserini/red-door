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
        calls.push(['prompt', text, options]); return 'Ara smiles. "The rain has overstayed its welcome."';
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

test('TALK stays entirely in the client; normal moves still use the existing save API', async () => {
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
    await door.submit('leave');
  } finally {
    for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
