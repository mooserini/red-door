# Red Door launch

## Preserved version

Private repository: https://github.com/mooserini/red-door

`freeze-2026-09-07` points to `48ba81efd31a7895c2ad09e78771d28e18333988`.
That tag is the exact approved local experience. Subsequent deployment work
does not change any file in `public/` or the game rules.

## Live deployment on 2026-09-07

This section records the original launch. For current route ownership, use the
next section; the original two-route arrangement is no longer current.

- Worker `red-door` on the existing **Workers Free** account. No plan purchase.
- Version `a2821989-f25f-4970-b46a-4163ea68f00d`.
- Dedicated D1 `red-door`: `9be6882b-1919-4c79-a96a-0143e635a06e`.
- Dedicated R2 `red-door-assets`: ten release assets.
- Routes: `www.getadongle.com/*` and `getadongle.com/*` in zone
  `4e2ee5bb4dee2ff2ddcced14e2e0d5e9`.
- Account: `815bcdaf788850798df37ed8f3afb8d0`.

The former CPU blocker was resolved by moving password stretching into Web
Crypto in the browser and storing a separate verifier on the server. The larger
CPU setting was removed. See AUTHENTICATION.md for the protocol and limits.
The initial frozen tag remains unchanged; it predates this authentication change.

The production wrapper overlays release paths and `/api/`; all other requests
pass through to the original R2 origin. No original resonantmirror objects,
custom domains, DNS records, or original D1 contents were changed.
`railway.getadongle.com` is outside the Worker routes. workers.dev and preview
URLs remain disabled.

## Verification receipts

- `hosted-verification.json`: disposable registration, woods move, logout,
  denied old session, and case-insensitive login restoring the identical save.
- `launch-verification.json`: live route IDs, Worker version, ten asset hashes,
  root/index/query-string checks on both hosts, unchanged original avatar on
  www and railway hosts. Cloudflare appends a dynamic challenge script to
  HTML responses; the recorded HTML hash removes that identified injection
  before comparing with the shipped file. Other assets match byte-for-byte.
- `deployment-state.json`: historical pre-launch staging receipt. Its blocked
  status describes that earlier attempt, not the current deployment.
- Original entrance and avatar backup copies remain locally under
  `../backups/pre-launch-2026-09-07/`, excluded from Git.

## Subsequent deployment

Current route ownership after the portfolio migration:

- `getadongle.com/*` belongs to `red-door`. This is the only route declared in
  this repository's production configuration.
- `www.getadongle.com/*` belongs to `resonant-mirror-portfolio`, maintained in
  the separate `mooserini/resonant-mirror` repository. Do not add it back here.
- The portfolio serves the playable entrance at
  `https://www.getadongle.com/red-door` through its `RED_DOOR` service binding.
  It delegates the game's `/api/*` and allowlisted static assets to `red-door`,
  preserving same-origin game sessions. Portfolio authentication is separate.

The dedicated D1 and R2 resources above remain the game's storage. A routing
configuration correction does not require reapplying migrations or uploading
unchanged game assets. Validate with `npm run check` and `npm test`; both local
and production bundles are built by the test command. Deploy only when a hosted
change is needed, using the production configuration below.

From this directory:

```sh
npm run check
npm test
npx wrangler d1 migrations apply red-door --remote --config wrangler.production.jsonc
npm run upload:production
npx wrangler deploy --config wrangler.production.jsonc
```

Migrations affect only the dedicated Red Door DB; asset uploads affect only
red-door-assets. For breaking frontend/API changes, stage compatible versions
before the route cutover. Do not run a production deploy with the local config.
After every release, verify authentication/persistence and the original-origin
passthrough again. Record the new version and hashes.

## Rollback

For a game-code regression, roll back the `red-door` Worker to a verified prior
version while preserving its D1/R2 bindings and current apex-only route.
Coordinate any incompatible frontend assets or schema changes separately.

If removing the apex overlay entirely, inspect live route ownership and remove
only `getadongle.com/*` when it points to `red-door`, then set `routes: []` here.
Do not remove the portfolio's `www` route or use the original launch's two route
IDs as a current deletion list. The portfolio's service binding still calls the
game independently of its public route, so removing the apex overlay alone does
not disable `/red-door` on the portfolio. Retain the game D1/R2 resources so
accounts and saves survive rollback.

`0001_red_door.sql` uses a trigger WHEN clause equivalent to the frozen CASE
expression because the hosted migration parser rejected its nested END syntax.
The remotely applied schema retains transactional revision guards/checkpoints.

## Barkeep experiment — 2026-09-08 EDT

Optional local Chrome dialogue was deployed with a scripted fallback. Talking
is intercepted before the game command/save request path. No migrations were
applied, and no production account or save was changed during verification.

- Red Door Worker: `7724021e-9f30-4cec-8964-23266a66bae0`.
- Portfolio proxy Worker: `1a024f66-3c5b-4342-b52a-7dbad9c5eb0d`.
- Only `barkeep.js` and `door.js` were uploaded to R2; allowlists were deployed
  before uploading the importing `door.js`.
- Both hosted `www` assets matched local files byte for byte. The apex
  `/barkeep.js` endpoint redirected to the verified `www` asset with HTTP 301.
- SHA-256 `barkeep.js`: `3db20baccebd233a15156cf0c29227690121083a77ec8afd66f0501601de67cc`.
- SHA-256 `door.js`: `fc578223a851192532291a82175987011730fe939fc059209f1731c0e4b03a4e`.
- Game type checks and all 20 tests passed; portfolio lint/worker checks and
  all 17 tests passed. Focused dialogue and proxy tests also passed after the
  final lifecycle and route assertions.
- A temporary localhost fixture loaded the actual module in the user's Chrome
  with synthetic tavern state. The first attempt hit the 12-second fallback;
  the second returned local model dialogue. Explicit scripted mode worked.
  The fixture tab and server were closed afterward. No dialogue is included
  in this deployment record.
- Integration tests verified that talk/on/off/reset made no API/save requests,
  while an ordinary game command still used the normal command API.

Live asset delivery and local Chrome inference were verified separately. A
production character was not moved to the tavern for an end-to-end play test.

## References

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/configuration/routing/routes/
- https://developers.cloudflare.com/r2/buckets/public-buckets/

## Inventory ownership clarification — 2026-09-08 EDT

Only the R2 `barkeep.js` asset was updated. Every turn now identifies selected
inventory under `player.inventory`; the system prompt makes ownership fixed,
uses player-facing possessives, and distinguishes offers from completed
transfers. Invented specials, ingredients, and proposed prices remain allowed.

Both build checks and all 21 tests passed, including current-inventory updates
within one dialogue session. The hosted asset matched the local file byte for
byte. SHA-256: `ba2c98f9fce2eb38400884cac1aa97718b398a9ec5c58ee145834b75377c7504`. These tests verify the prompt/data contract, not
a guarantee that model wording can never misattribute an item. No game save
was modified, and conversation mode was not added.
