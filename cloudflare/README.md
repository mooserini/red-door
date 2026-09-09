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
- Login uses dedicated username and password fields in a separate form. The
  terminal command input always stays a text field, so Chrome can save the real
  login without mistaking later game commands for replacement passwords.
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

## Temporary barkeep dialogue experiment

At the tavern, type `talk` or `talk <your words>` (up to 240 characters).
Ara uses Chrome's built-in Prompt API only when it reports an already available
English text model. Unsupported browsers, models needing a download, errors,
blocked responses, and a 12-second timeout use rotating authored lines instead.
There is no automatic model download, paid API, or cloud inference fallback.

`talk off` uses only scripted lines. `talk on` enables the available local model
again. `talk reset` destroys the temporary model conversation. Leaving the game,
changing location, or unloading the page destroys it too; it also restarts after
six successful replies to bound context. The terminal labels local AI and
scripted replies separately. Output uses text nodes, never HTML or executable
commands. The model is asked to stay friendly and respect game facts; that prompt
is not a guarantee of safe or accurate prose.

Dialogue commands are handled before the save API and do not create game
receipts. A proposed item and price may create a short-lived server quote. The narrator has no fetch, storage, or database access. It receives
only a fixed tavern scene, bounded inventory labels, copper balance, and the player's current
words, not account identity, authentication material, health, or save metadata.
The model's prose cannot alter inventory, health, quests, or saves. Conversation
text remains in the page and model session only; there is no application storage,
analytics, or submission of that text. Browser/OS memory management is outside
that application-level guarantee. Normal game actions continue saving as before.

Ara can now return a structured offer alongside her dialogue. Items are invented
by the model, not selected from a catalog. The browser submits only the item name, type,
and integer price to `/api/tavern-offers`; the server validates a 1–20 copper
range, binds the quote to the signed-in caller and current world revision, and
keeps at most one pending offer per caller. Offers expire after ten minutes.
No transcript is submitted. Invalid/unavailable model output creates no offer.

`buy` explicitly accepts the displayed server quote. `/api/commands` reads that
quote (never a client-supplied replacement price), verifies balance and location,
then saves the debit and purchased inventory label together through the existing
receipt transaction. A trigger consumes the quote in the same transaction.
Retries cannot charge twice. A stale, replaced, expired, or unaffordable offer
changes nothing. `cancel`, a new conversation turn, or a move discards the local
offer; another quote replaces it on the server. Successful purchases clear the
model context so the next turn starts from the saved balance and possessions.
Purchased items carry a `food` or `drink` type alongside their inventory labels.
The engine maps these types to `eat <item name>` and `drink <item name>`;
`use <item name>` selects the appropriate supported action. Matching ignores
case but requires the full name. Each action consumes one serving through the
same revision-checked receipt transaction; retries cannot consume a second one.
Bare verbs ask for an item name. Wrong types and missing items reject without
changing a save. Consumption does not grant healing, change copper, or move the
player. No model participates in validating or reconciling these actions.

`state.itemTypes` maps case-folded labels to a supported type. Inventory retains
one label per serving, keeping older saves readable. Identically named servings
must share a type. Unknown older items are unusable until explicitly classified;
there is no keyword guessing. The displayed inventory and offer include the type.
For Moose, the two purchases reported in the test were explicitly classified by
an operator receipt; the original items and balance were preserved.

For this experiment, Moose receives a one-time operator-recorded 20-copper purse.
Existing other callers default to zero; there is no public refill command. The
old tarnished coin remains a separate inventory object, not a currency balance.
These are fantasy tavern prices, not claims about historical purchasing power.
Client-side AI proposals are untrusted and bounded, not a cheat-proof market.

Shared discoveries, durable AI memory, new locations, and autonomous world
expansion are not implemented.

API reference: https://developer.chrome.com/docs/ai/prompt-api

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
- The browser stretches passwords with salted PBKDF2-HMAC-SHA256 at 600,000
  iterations; the Worker stores and checks a separate SHA-256 verifier. See
  [AUTHENTICATION.md](AUTHENTICATION.md) for the protocol and its limits. Sessions use
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

The game is live at [Red Door](https://www.getadongle.com/red-door) on the
existing Workers Free account. Browser-side password stretching replaced the
server KDF; no paid subscription was purchased. The original public R2 bucket
remains intact behind a Worker overlay, with unrelated paths passed through.

[hosted-verification.json](hosted-verification.json) records a hosted disposable
caller registering, moving, logging out, and returning to the same save.
[launch-verification.json](launch-verification.json) records the deployed version,
route IDs, static hashes, and unchanged shared avatar on both original hosts.
[credential-field-verification.json](credential-field-verification.json) records
the subsequent input-field fix, its Chrome checks, and updated deployed hashes.

See [DEPLOYMENT.md](DEPLOYMENT.md) for resources, deployment, and rollback.
`wrangler.jsonc` remains local; `wrangler.production.jsonc` is production.
The game's production configuration owns only `getadongle.com/*`. The separate
portfolio owns `www.getadongle.com/*` and forwards the playable `/red-door`
entrance and game requests through its `RED_DOOR` service binding.
The temporary barkeep experiment adds optional browser-model dialogue. The
game's rules remain authoritative; confirmed purchases persist, while dialogue
and model-driven world expansion do not.

Cloudflare references consulted:
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
