import { createWriter } from './pacing.js';
import { derivePasswordKey } from './auth.js';

const PLACES = { tavern: 'The Old Tavern', woods_edge: 'Dark Woods edge', woods: 'The Dark Woods' };
export function createDoor({ screen, input, inputRow, tree, romBtn, mobilePrompt, repaint, onLeave }) {
  const writer = createWriter(screen);
  let active = false, busy = false, step = 'menu', handle = '', password = '', registering = false;
  let world = null, pending = null;
  const secret = () => step === 'password' || step === 'confirm';
  const prompt = () => ({ menu: '[L] Log in  [N] New caller  [Q] Return > ', handle: 'Handle > ',
    password: 'Password > ', confirm: 'Again > ', game: 'red-door > ' })[step];
  async function api(path, data) {
    const response = await fetch(path, data === undefined ? { cache: 'no-store' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    let result;
    try { result = await response.json(); }
    catch { throw Object.assign(new Error('The line dropped. Try again.'), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(result.error || 'The line dropped.'), { status: response.status });
    return result;
  }
  function controls() {
    input.disabled = busy;
    input.type = secret() ? 'password' : 'text';
    input.autocomplete = secret() ? (registering ? 'new-password' : 'current-password') : step === 'handle' ? 'username' : 'off';
    input.setAttribute('aria-label', secret() ? (step === 'confirm' ? 'Confirm password' : 'Password') : step === 'handle' ? 'Handle' : 'Terminal command');
    input.maxLength = secret() ? 128 : step === 'handle' ? 20 : 128;
    inputRow.classList.toggle('hide', busy);
    tree.replaceChildren(); tree.classList.add('hide');
    if (!busy && matchMedia('(max-width:519px)').matches && (step === 'menu' || step === 'game')) {
      const options = step === 'menu' ? [['l', 'Log in'], ['n', 'New caller'], ['q', 'Return to Mirror']]
        : ['tavern', 'woods', 'explore', 'search', 'rest', 'drink', 'status', 'leave'].map(v => [v, v]);
      for (const [value, label] of options) {
        const button = document.createElement('button'); button.className = 'cmd-btn'; button.textContent = label;
        button.addEventListener('click', () => { void submit(value); }); tree.append(button);
      }
      tree.classList.remove('hide');
    }
    repaint();
    if (!busy) input.focus();
  }
  async function showWorld() {
    const state = world.state;
    await writer.write([
      { text: PLACES[state.location] || state.location, style: 'magenta' },
      state.last_scene, '',
      `${state.name}  |  Health: ${state.health}  |  Inventory: ${state.inventory.join(', ') || 'empty'}`,
      { text: `Saved. Revision ${world.revision}.`, style: 'dim' }, ''
    ]);
  }
  async function open() {
    if (active) return;
    active = true; busy = true; step = 'menu'; pending = null;
    input.value = ''; password = ''; handle = '';
    romBtn.classList.add('hide'); mobilePrompt.classList.add('hide');
    screen.classList.add('door-screen');
    writer.clear(); // Door handoff: clear display and home before sending anything.
    controls();
    await writer.write([
      { text: 'RED DOOR', style: 'magenta' },
      { text: 'CONNECT 2400', style: 'dim' }, '',
      'A small world behind the glass.', ''
    ]);
    try {
      const data = await api('/api/world'); world = data.world; step = 'game';
      await writer.write([`Welcome back, ${data.handle}.`, '']); await showWorld();
    } catch (error) {
      if (error.status !== 401) await writer.write([{ text: error.message, style: 'danger' }]);
      await writer.write(['Your handle. Your password. Your place in the world.',
        'No email. No password resets. No recovery key.',
        'Forget your password, and this handle stays out of reach.', '']);
    }
    busy = false; controls();
  }
  async function leave() {
    password = ''; handle = ''; input.value = ''; pending = null;
    active = false; busy = false; world = null;
    writer.clear(); screen.classList.remove('door-screen');
    input.type = 'text'; input.disabled = false; input.autocomplete = 'off'; input.maxLength = 128;
    input.setAttribute('aria-label', 'Terminal command');
    onLeave();
  }
  async function submit(raw) {
    if (!active || busy) return;
    const value = secret() ? raw : raw.trim();
    input.value = '';
    busy = true; controls();
    try {
      if (step === 'menu') {
        const choice = value.toLowerCase();
        if (choice === 'q' || choice === 'quit' || choice === 'leave') { await leave(); return; }
        if (!['l', 'login', 'n', 'new'].includes(choice)) { await writer.write(['Choose L, N or Q.']); return; }
        registering = choice === 'n' || choice === 'new'; step = 'handle';
        await writer.write([registering ? 'NEW CALLER' : 'RETURNING CALLER',
          'Handle: 3–20 letters, numbers, underscores or hyphens.']);
      } else if (step === 'handle') {
        if (!/^[A-Za-z0-9_-]{3,20}$/.test(value)) { await writer.write(['Use 3–20 letters, numbers, underscores or hyphens.']); return; }
        handle = value; step = 'password';
        await writer.write([`Handle: ${handle}`, registering ? 'Choose a password: at least 8 characters. Remember it.' : 'Enter your password.']);
      } else if (step === 'password') {
        if (value.length < 8 || new TextEncoder().encode(value).length > 128) { await writer.write(['Use at least 8 characters and no more than 128 bytes.']); return; }
        if (registering) { password = value; step = 'confirm'; await writer.write(['Enter it once more.']); }
        else await authenticate(value);
      } else if (step === 'confirm') {
        if (value !== password) { password = ''; step = 'password'; await writer.write(['Those did not match. Choose your password again.']); return; }
        const chosen = password; password = ''; await authenticate(chosen);
      } else if (step === 'game') {
        const cmd = value.toLowerCase();
        if (!cmd) return;
        // Passwords never pass through this echo, history, browser storage, or URLs.
        await writer.write([{ text: `red-door > ${value}`, style: 'dim' }]);
        if (cmd === 'leave' || cmd === 'exit' || cmd === 'quit') {
          if (pending) { await writer.write(['Your last move is unconfirmed. RETRY or STATUS before leaving.']); return; }
          await leave(); return;
        }
        if (cmd === 'logout') {
          if (pending) { await writer.write(['Your last move is unconfirmed. RETRY or STATUS before logging out.']); return; }
          await api('/api/logout', {}); await leave(); return;
        }
        if (cmd === 'help') {
          await writer.write(['tavern / woods / explore / search / rest / drink',
            'status  - read your saved character', 'retry   - confirm an interrupted move',
            'leave   - return to the Mirror', 'logout  - end this login and return', '']); return;
        }
        if (cmd === 'status' || cmd === 'reconnect') {
          // Confirm the pending request before fetching newer state. It may already have committed.
          if (pending) await sendPending();
          const result = await api('/api/world'); world = result.world; await showWorld(); return;
        }
        if (cmd === 'retry') {
          if (!pending) { await writer.write(['No unconfirmed move.']); return; }
          await sendPending(); return;
        }
        if (pending) { await writer.write(['RETRY your unconfirmed move before making another.']); return; }
        pending = { request_id: crypto.randomUUID(), expected_revision: world.revision, command: cmd };
        await sendPending();
      }
    } catch (error) {
      if (error.status === 401) { step = 'menu'; world = null; pending = null; }
      await writer.write([{ text: error.message, style: 'danger' }]);
      if (pending) await writer.write(['The move may have saved. Type RETRY to confirm it.']);
    } finally {
      if (active) { busy = false; controls(); }
    }
  }
  async function authenticate(chosen) {
    password = '';
    try {
      const { salt } = await api('/api/auth-params', { handle });
      const password_key = await derivePasswordKey(chosen, salt);
      chosen = '';
      const result = await api(registering ? '/api/register' : '/api/login', { handle, salt, password_key });
      world = result.world; step = 'game';
      await writer.write([`Welcome${registering ? '' : ' back'}, ${result.handle}.`, 'Type HELP for commands.', '']);
      await showWorld();
    } catch (error) {
      step = 'menu'; handle = ''; throw error;
    }
  }
  async function sendPending() {
    try {
      const result = await api('/api/commands', pending);
      const travel=['tavern','home','woods','forest','explore','deeper'].includes(pending.command);
      const moved=world && result.world.state.location!==world.state.location;
      // Clear only once travel is acknowledged. Failed moves keep the current scene.
      if(travel || moved) writer.clear();
      world = result.world; pending = null; await showWorld();
    } catch (error) {
      // These statuses explicitly reject the move; network/5xx remain retryable.
      if ([400, 409, 401, 403, 413, 415].includes(error.status)) pending = null;
      if (error.status === 401) { step = 'menu'; world = null; }
      throw error;
    }
  }
  return { open, submit, get active() { return active; }, get busy() { return busy; },
    get prefix() { return prompt(); }, get secret() { return secret(); } };
}
