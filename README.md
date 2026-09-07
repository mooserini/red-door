# Red Door: terminal outside the world

Google hterm runs in the browser. Red Door's Python game engine and SQLite ledger
run on this Mac, outside the browser session. Both the terminal and the graphical
page send commands to the same server-owned world. This is a local single-user
proof; it is not yet a Synchronet instance or a Cloudflare deployment.

## Run

```sh
cd /Users/thomaskenny/Developer/Uncle-Russet/red-door-local
python3 server.py
```

- Terminal: http://127.0.0.1:8766/terminal
- Graphical world and receipts: http://127.0.0.1:8766/

Click inside the terminal and type `help`, `woods`, `search`, or `explore`.
`status` and `reconnect` read the latest saved world. `retry` resubmits an
unconfirmed command with its original request ID. No operating-system shell is
exposed. Keep the Python process running while playing; Ctrl-C stops it.
Restarting it restores the same database. No background service was installed.

The database lives outside the browser and source directory:

`/Users/thomaskenny/.local/share/red-door-local/world.sqlite3`

Use `--db /absolute/path/to/world.sqlite3` to select another local database and
`--port 8767` to select another port. A live SQLite file should stay on a local
filesystem. Upload a consistent SQLite backup or receipt export to a sync service,
rather than modifying a live synced database from multiple machines.

## The connection

```text
Browser: hterm keyboard + ANSI display
        | HTTP commands and server-rendered terminal text
Mac: Python game engine
        | one atomic transaction per action
Mac: SQLite world checkpoints + existence receipts
```

This uses hterm, the terminal component bundled with Google Secure Shell, embedded
in a normal webpage. It does not use the Secure Shell extension's SSH connection.
Turn-based commands use HTTP; an interactive Synchronet transport would need its
own adapter, commonly WebSockets to the backend process. There is no browser VM.

The browser sends a command, request ID and expected revision. The server locks
the ledger, checks for a prior identical request, calculates the next state,
and commits the checkpoint and receipt with SQLite `synchronous=FULL` before
returning terminal output. Random outcomes are decided once inside that operation.
Concurrent retries return the original receipt; stale revisions are rejected.
Neither browser interface is allowed to submit arbitrary replacement world state.
The older receipt-submission HTTP endpoint has been removed.

Every receipt includes the complete checkpoint and a chained checksum. Recovery
reads the last committed receipt without replaying randomness. These checksums
help detect accidental modification; they are not signatures or tamper-proofing.
The game is turn-based: no simulation tick is promised while nobody is connected.

The server binds only to 127.0.0.1, checks Host and Origin, accepts JSON commands,
and serves an explicit list of files. hterm uses in-memory preferences. Neither
interface uses cookies, localStorage or IndexedDB for world persistence. This
local proof has no user authentication or multiplayer identities. Public hosting
requires those boundaries and a durable storage adapter.

## Provenance and scope

The game actions adapt the Red Door source archive at
`/Users/thomaskenny/Developer/Tater-Tot/red-door-source-2026-08-08.zip`.
The archive and original `~/.red-door-state.json` remain untouched. Inventory
labels use spaces in this prototype. There is no narrator or sysop scheduler.

The two vendored JavaScript modules are exact copies from the installed Google
Secure Shell 0.80 extension. Versions and SHA-256 hashes are in
`web/vendor/provenance.json`; bundled license notices are in
`web/vendor/LICENSES.txt`. No extension settings, credentials or connection
profiles were copied. Source: https://chromium.googlesource.com/apps/libapps/

D1, R2 and Google Drive are not connected. Cloudflare Containers expose HTTP and
WebSockets rather than direct inbound SSH/TCP; the hosted runtime and persistence
adapter are a subsequent integration. See:
https://developers.cloudflare.com/containers/concepts/architecture/

## Verification

```sh
python3 -m unittest -v
node --check web/terminal.js
node --check web/app.js
```

Eight tests use temporary databases and cover process-kill recovery, exact retries,
concurrent random commands, stale sessions, invalid commands, forged state,
receipt alteration, and cross-origin write rejection. Interactive verification
sent `woods` through hterm, closed its tab and opened a new terminal: revision 10
and the existing inventory returned. See `terminal-verification.json` for that
snapshot. `verification.json` records the earlier graphical proof.
