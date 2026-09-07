import {lib} from './vendor/libdot/index.js';
import {hterm} from './vendor/hterm/index.js';

// hterm preferences and the unfinished input line are ephemeral. The server
// calculates every game action and commits its result before returning text.
let terminal, io, world, line = '', busy = true, pending = null;
const status = document.getElementById('connection');
const prompt = () => io.print('\x1b[31;1mred-door\x1b[0m > ');
async function api(path, request) {
  const response = await fetch(path, request && {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(request),
  });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error); error.status = response.status; throw error; }
  return body;
}
function connected(receipt) {
  world = receipt;
  status.textContent = `Connected · saved revision ${world.revision} on the Mac`;
}
async function reconnect() {
  if (!io) return;
  busy = true; line = '';
  io.print('\r\n');
  try {
    const data = await api('/api/terminal');
    connected(data.world); pending = null;
    io.print(data.output); busy = false; prompt(); terminal.focus();
  } catch (error) {
    busy = false;
    status.textContent = 'Server unavailable · last committed world remains on disk';
    io.println('Cannot reach Red Door. Start the server, then click Reconnect.');
  }
}
async function submit(command) {
  busy = true;
  if (command === 'help') {
    io.println('World: tavern, woods, explore, search, rest, drink');
    io.println('Terminal: status, reconnect, retry, clear, help');
    io.println('This terminal accepts game commands; it is not an operating-system shell.');
    busy = false; prompt(); return;
  }
  if (command === 'status' || command === 'reconnect') { await reconnect(); return; }
  if (command === 'clear') { io.print('\x1b[2J\x1b[H'); busy = false; prompt(); return; }
  if (pending && command !== 'retry') {
    io.println('A save is unconfirmed. Type retry to recover its receipt, or reconnect to read the world.');
    busy = false; prompt(); return;
  }
  if (!pending && command === 'retry') {
    io.println('There is no unconfirmed command.'); busy = false; prompt(); return;
  }
  pending ||= {request_id:crypto.randomUUID(), expected_revision:world.revision, command};
  try {
    const data = await api('/api/commands', pending);
    connected(data.receipt); pending = null; io.print(data.output);
  } catch (error) {
    if (error.status === 400 || error.status === 409) pending = null;
    io.println(error.message || 'Connection interrupted.');
    status.textContent = pending ? 'Save unconfirmed · type retry or reconnect' : 'Type reconnect to refresh the world';
  }
  busy = false; prompt();
}
function input(text) {
  if (busy || !world) return;
  // Ignore control sequences; accept a bounded line of ordinary game input.
  if (text.startsWith('\x1b')) return;
  for (const char of text) {
    if (char === '\r' || char === '\n') {
      const command = line.trim().toLowerCase(); line = ''; io.print('\r\n');
      if (command) { void submit(command); return; }
      prompt();
    } else if (char === '\x7f' || char === '\b') {
      if (line) { line = line.slice(0,-1); io.print('\b \b'); }
    } else if (char === '\x03') {
      line = ''; io.print('^C\r\n'); prompt();
    } else if (/^[\x20-\x7e]$/.test(char) && line.length < 128) {
      line += char; io.print(char);
    }
  }
}
try {
  await hterm.initPromise;
  terminal = new hterm.Terminal({storage:new lib.Storage.Memory()});
  terminal.onTerminalReady = () => {
    terminal.prefs_.set('background-color','#101715');
    terminal.prefs_.set('foreground-color','#e5e6dc');
    terminal.prefs_.set('font-size',14);
    terminal.prefs_.set('cursor-color','#d79c7f');
    terminal.prefs_.set('color-palette-overrides',{'8':'#9aa99b'});
    terminal.prefs_.set('audible-bell-sound','');
    io = terminal.io.push(); io.onVTKeystroke = input; io.sendString = input;
    terminal.installKeyboard();
    io.println('\x1b[31;1mRED DOOR\x1b[0m · Google hterm ' + hterm.VERSION);
    io.println('The tab is your window. The world lives outside it.');
    void reconnect();
  };
  terminal.decorate(document.getElementById('terminal'));
} catch (error) { status.textContent = 'Terminal initialization failed: ' + error.message; }
document.getElementById('reconnect').addEventListener('click',()=>{if(!busy) void reconnect();});
