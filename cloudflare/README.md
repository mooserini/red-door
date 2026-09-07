# The Mirror opens the Red Door

A Cloudflare implementation of Tom's existing Mirror entrance and Red Door game.
The original Python proof and its live SQLite database remain independent.

`reddoor` or `red door` clears the screen and homes the output before opening the
door. The Mirror's boot sequence, date behavior, fonts, copy and existing commands
come from the live original at https://www.getadongle.com/index.html, captured on
2026-09-07. `source-provenance.json` records the source URLs and hashes. The
Base44 browser-local game implementation is not used.

## Caller experience

- A new caller chooses a handle and types a password twice. A returning caller
  enters the same handle and password. Handles are case insensitive.
- No email, recovery key, password reset, or operator recovery endpoint exists.
  The registration screen explains the consequence before account creation.
- Each handle owns one character. This is not yet a shared multiplayer world.
- `leave` clears the door and returns to the Mirror; `logout` also revokes the
  current login. Login cookies expire after seven days. Logging back in restores
  the character from D1.
- `status` reads the saved character. `retry` resubmits an unconfirmed move with
  its original request ID. The UI blocks further moves while one is unconfirmed.
- Save confirmation comes from the server before it is displayed. Closing the
  page while text is arriving does not undo an acknowledged action.

## Pacing

The Mirror's regular diagnostics retain their original 430 ms timing, and its
ordinary boot lines retain 140 ms timing. RAM is the deliberate exception: three
0–640 KB passes, in 64 KB steps at 65 ms each, with 160 ms pauses at the end of
each pass. The floppy spends 900 ms initializing, 500 ms seeking, then 250 ms
showing Ready. Bootstrap waits 650 ms, reads for 1100 ms, and retries for 900 ms
before reporting the original disk error. This is an interpretation of Tom's
remembered rhythm, not a claim of cycle-accurate PC 6300 emulation.

A quiet synthesized spindle/seek sound follows the floppy stages when browser
audio has been unlocked by a click or keypress. A fresh page remains usable and
boots silently if autoplay is unavailable; typing `boot` after interaction gives
the audible sequence. Existing date triggers and the PC 6300 font are preserved.

`who`, `mirror`, `work`, and `contact` clear the screen before opening their own
view. Help, unknown commands and short replies append. In the door, acknowledged
travel or a location change clears for the new scene; same-location events append.
Clearing does not alter the established draw timing.

The door models an uncompressed 2400-bit/s, 8N1 connection: ten wire bits per
character, approximately 240 characters per second. A displayed newline charges
two bytes for CR/LF. Color changes charge an approximate nine nonprinting ANSI
bytes. After 480–1200 bytes, the display adds a 30–140 ms stall. Those stalls are
an authored approximation, not measured LoRD behavior. No video was used to
claim a precise historical match.

At 60 Hz, about four characters arrive per frame. Output uses a shared wire-byte
counter so stalls still occur across short lines and commands. A background tab
does not burst all delayed output onto the screen on return. Keyboard input is
not artificially slowed. Reduced-motion preferences disable flicker and paced
printing. Tune `public/pacing.js` after Tom supplies a preferred LoRD reference.

Timing source: [USRobotics modem glossary](https://support.usr.com/support/5686g/5686g-ug/gloss.html).

## Runtime and persistence

- A Worker serves only allowlisted public assets through its `STATIC` R2 binding.
- `DB` is a D1 binding for accounts, session hashes, characters, receipts and
  short-lived login throttling counters. No Cloudflare API credential reaches
  the browser or is required inside the Worker.
- The Worker ports the existing Python game rules into TypeScript. Commands
  calculate state on the server. There is no client-authored replacement state.
- A receipt insert validates the expected revision and previous checksum, then
  updates the character checkpoint using SQLite triggers in the same transaction.
  Concurrent retries return the original committed result, including randomness.
- Checksums are change-detection receipts, not signatures or protection against
  a database administrator. Each initial checkpoint starts its own chain; the
  Mac's existing player is not imported or exposed as a public account.
- Passwords use salted PBKDF2-HMAC-SHA256 with 600,000 iterations. Sessions use
  random 256-bit tokens; only their SHA-256 hashes are stored in D1. Cookies are
  Secure, HttpOnly and SameSite=Strict. Writes require the same Origin and a
  bounded JSON body. Login attempts are throttled before hashing.
- The daily scheduled cleanup removes expired sessions and throttling counters,
  not accounts or saves. Request logs exclude credentials, handles and state.

## Local preview

From this directory:

```sh
npm ci
npm run types
npm run check
npm run build
npm test
npm run seed
npm run dev
```

Open http://localhost:8787, skip or enter the boot date, then type `reddoor`.
`seed` uses **only local** D1 and R2. Local state lives under `.wrangler/state`.
After changing static files, rerun `npm run seed` and reload; R2 does not provide
hot module replacement. The development server keeps the same URL.

The API tests use disposable Miniflare D1/R2 resources and the actual Worker
bundle. They exercise password hashing, login/logout, separate characters,
same-origin writes, forged-state rejection, concurrent random-command retries,
revision races and login throttling. Timing tests verify the 240 cps baseline,
control-byte overhead and stalls across lines.

## Publication status

The approved version is frozen in the private GitHub repository
[mooserini/red-door](https://github.com/mooserini/red-door), tagged
`freeze-2026-09-07`. Deployment preparation follows in a separate commit.

The dedicated remote D1 schema and R2 assets are staged. The production Worker
has not been attached to the live domain: Cloudflare rejected its CPU allowance
on Workers Free. Workers Paid requires Tom's approval before purchase. The
original live site and its existing bucket remain unchanged.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the exact resources, reviewed routes,
remaining hosted checks, and rollback procedure. `wrangler.jsonc` remains the
local development configuration; `wrangler.production.jsonc` is the explicit
production configuration. The production wrapper passes unrelated site paths
through to the original origin.

Cloudflare references consulted:
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
