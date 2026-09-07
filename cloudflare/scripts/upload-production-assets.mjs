import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

// This publishes only the separate Red Door bucket, never resonantmirror.
async function upload(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, file.name);
    if (file.isDirectory()) { await upload(path); continue; }
    const type = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
      json: 'application/json', ttf: 'font/ttf', png: 'image/png' }[path.split('.').pop()];
    if (!type) throw new Error(`Unexpected public file: ${path}`);
    const key = relative('public', path);
    const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js',
      'r2', 'object', 'put', 'red-door-assets/' + key, '--file', path,
      '--content-type', type, '--remote', '--config', 'wrangler.production.jsonc'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr + result.stdout);
    console.log(`${createHash('sha256').update(await readFile(path)).digest('hex')}  ${key}`);
  }
}
await upload('public');
