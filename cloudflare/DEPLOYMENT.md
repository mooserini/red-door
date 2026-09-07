# Red Door launch

## Preserved version

Private repository: https://github.com/mooserini/red-door

`freeze-2026-09-07` points to `48ba81efd31a7895c2ad09e78771d28e18333988`.
That tag is the exact approved local experience. Subsequent deployment work
does not change any file in `public/` or the game rules.

## Prepared on 2026-09-07

- Dedicated D1 `red-door`: `9be6882b-1919-4c79-a96a-0143e635a06e`.
- `0001_red_door.sql` applied remotely. The revision guard uses an equivalent
  trigger `WHEN` clause because the hosted migration parser rejected the nested
  `CASE ... END` form. Local concurrency/retry checks still pass.
- Dedicated private R2 bucket `red-door-assets`: all nine public files uploaded.
- `deployment-state.json` records asset SHA-256 checks and the original live
  entrance/shared avatar hashes. Local backup copies are under
  `../backups/pre-launch-2026-09-07/` and are intentionally excluded from Git.
- Existing `resonantmirror` R2 and D1 resources were not modified.
- The original R2 custom domains remain active: `getadongle.com`,
  `www.getadongle.com`, and `railway.getadongle.com`.
- No live Worker route was added. Workers Free rejected the configured CPU
  allowance with API error `100328`. No subscription was purchased.

The account is `815bcdaf788850798df37ed8f3afb8d0`; the getadongle.com zone is
`4e2ee5bb4dee2ff2ddcced14e2e0d5e9`. These are resource identifiers, not credentials.

## Remaining launch steps

1. Enable Workers Paid with Tom's approval. Cloudflare lists a $5/month minimum
   plus metered overages. The production configuration caps each invocation at
   1,000 CPU milliseconds; this is not an account spending cap. The password KDF
   remains PBKDF2-HMAC-SHA256 with 600,000 iterations.
2. Recheck the existing Worker routes before adding these two entries to
   `wrangler.production.jsonc`:

   ```json
   "routes": [
     { "pattern": "www.getadongle.com/*", "zone_id": "4e2ee5bb4dee2ff2ddcced14e2e0d5e9" },
     { "pattern": "getadongle.com/*", "zone_id": "4e2ee5bb4dee2ff2ddcced14e2e0d5e9" }
   ]
   ```

   The production entrypoint overlays the release's known paths and `/api/`.
   All other requests pass through to the original R2 origin unchanged. The
   `railway.getadongle.com` hostname is outside these routes. `workers.dev` and
   preview URLs remain disabled. Do not detach any R2 custom domain or edit DNS.
3. Run the following from this directory:

   ```sh
   npm run check
   npm test
   npx wrangler deploy --config wrangler.production.jsonc
   ```

   Migrations and assets are already staged. For future asset releases use
   `npm run upload:production`; for future migrations use
   `npx wrangler d1 migrations apply red-door --remote --config wrangler.production.jsonc`.
4. Verify the hosted entrance at both `/` and `/index.html`, including query
   strings. Compare every release asset against the recorded SHA-256 hashes.
   Confirm an unrelated original asset still passes through and the Railway
   avatar URL remains available. Exercise boot/font/rendering in the browser.
5. With a disposable hosted caller, register, move, log out, and log back in;
   verify the saved revision and character persist. Record hosted latency/CPU
   and the deployment version. Local tests do not prove hosted CPU allowance
   or R2-origin passthrough behavior.

## Rollback

If hosted validation fails, remove only the two routes above that point to
`red-door` from the zone's Workers Routes. Restore `routes: []` in the production
configuration. The existing public R2 origin then serves the original site;
none of its objects were overwritten. Keep the new D1 and R2 resources so saves
and release files survive rollback. Record route IDs and deployment version
after a successful launch so removal is exact.

## References

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/configuration/routing/routes/
- https://developers.cloudflare.com/r2/buckets/public-buckets/
