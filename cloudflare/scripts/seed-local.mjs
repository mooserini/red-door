import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

// Explicitly local-only. Remote publication is a separate operation.
function wrangler(args) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr + result.stdout); process.exit(result.status || 1); }
}
wrangler(['d1', 'migrations', 'apply', 'red-door', '--local']);
async function walk(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, file.name);
    if (file.isDirectory()) await walk(path);
    else {
      const type = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
        json: 'application/json', ttf: 'font/ttf', png: 'image/png' }[path.split('.').pop()];
      if (!type) throw new Error(`Unexpected public file: ${path}`);
      wrangler(['r2', 'object', 'put', 'red-door-assets/' + relative('public', path), '--file', path, '--content-type', type, '--local']);
    }
  }
}
await walk('public');
console.log('Local D1 migrated; public files copied into local R2. No remote writes.');
