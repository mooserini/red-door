import worker from './worker';

// Overlay the existing public R2 origin. Everything outside this release keeps
// its original origin behavior, including unrelated pages and shared images.
const releasePaths = new Set([
  '/', '/index.html', '/mirror.css', '/mirror.js', '/door.js', '/pacing.js', '/auth.js',
  '/assets/projects-core.v1.js', '/assets/projects.json',
  '/assets/fonts/Ac437_ATT_PC6300.ttf', '/assets/linktree-qr-400.png'
]);

export default {
  fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (releasePaths.has(path) || path.startsWith('/api/')) return worker.fetch(request, env);
    return fetch(request);
  },
  scheduled: worker.scheduled
} satisfies ExportedHandler<Env>;
