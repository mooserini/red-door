# Red Door launch

## Preserved version

Private repository: https://github.com/mooserini/red-door

`freeze-2026-09-07` points to `48ba81efd31a7895c2ad09e78771d28e18333988`.
That tag is the exact approved local experience. Subsequent deployment work
does not change any file in `public/` or the game rules.

## Live deployment on 2026-09-07

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

Remove only the two route IDs in `launch-verification.json` that point to
red-door from the zone's Workers Routes, and restore `routes: []` in production
config. The untouched original R2 origin then serves the original site. Retain
the game D1/R2 resources so saves and release files survive rollback.

`0001_red_door.sql` uses a trigger WHEN clause equivalent to the frozen CASE
expression because the hosted migration parser rejected its nested END syntax.
The remotely applied schema retains transactional revision guards/checkpoints.

## References

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/configuration/routing/routes/
- https://developers.cloudflare.com/r2/buckets/public-buckets/
