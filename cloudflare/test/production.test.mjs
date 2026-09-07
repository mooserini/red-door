import { test } from 'node:test';
import assert from 'node:assert/strict';
import production from '../dist/production/production.js';

test('production overlay preserves unrelated origin responses and serves the frozen entrance', async () => {
  const originalFetch = globalThis.fetch;
  const request = new Request('https://www.getadongle.com/assets/other-project.png?v=2');
  const originResponse = new Response('original image', { headers: { 'Content-Type': 'image/png', 'X-Origin': 'R2' } });
  globalThis.fetch = async received => { assert.equal(received, request); return originResponse; };
  try {
    assert.equal(await production.fetch(request, {}), originResponse);
    assert.equal(originResponse.headers.has('Content-Security-Policy'), false);
    const page = await production.fetch(new Request('https://www.getadongle.com/?boot=1'), {
      STATIC: { get: async key => {
        assert.equal(key, 'index.html');
        return { httpEtag: '"frozen"', body: 'frozen entrance', writeHttpMetadata: headers => headers.set('Content-Type', 'text/html') };
      } }
    });
    assert.equal(await page.text(), 'frozen entrance');
    assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    const api = await production.fetch(new Request('https://www.getadongle.com/api/world'), {});
    assert.equal(api.status, 401);
  } finally { globalThis.fetch = originalFetch; }
});
