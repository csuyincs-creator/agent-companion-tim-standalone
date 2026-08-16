import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAiApiHandler } from '../server/ai-run-server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIRECTORIES = [
  ['dist'],
  ['packages', 'web-component', 'assets'],
  ['assets', 'effects']
];
const PUBLIC_FILES = new Set([
  '/apps/demo/standalone.html',
  '/apps/demo/basic-host.css',
  '/apps/demo/settings-drawer.css',
  '/apps/demo/settings-drawer.js'
]);
const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);
export function resolvePublicFile(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\\')) return null;
  if (/\/(?:\.{1,2})(?:\/|$)/.test(decoded)) return null;
  const relative = normalize(decoded.replace(/^\/+/, ''));
  if (!relative || relative.startsWith('..') || isAbsolute(relative)) return null;
  const target = resolve(root, relative);
  if (PUBLIC_FILES.has(decoded)) return target;
  for (const segments of PUBLIC_DIRECTORIES) {
    const base = resolve(root, ...segments);
    if (target.startsWith(`${base}\\`)) return target;
  }
  return null;
}

function sendText(response, status, body, contentType) {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': status === 200 ? 'no-cache' : 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

export function createDemoServer({ aiHandler = createAiApiHandler() } = {}) {
  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname === '/api/ai/run' || url.pathname === '/api/ai/config' || url.pathname === '/api/ai/config/test' || url.pathname === '/api/ai/codex/models') {
      return aiHandler(request, response);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendText(response, 405, 'Method not allowed', 'text/plain; charset=utf-8');

    try {
      const route = url.pathname === '/standalone'
        ? '/apps/demo/standalone.html'
        : url.pathname;
      const target = resolvePublicFile(route);
      if (!target) return sendText(response, 404, 'Not found', 'text/plain; charset=utf-8');
      const body = await readFile(target);
      return sendText(response, 200, request.method === 'HEAD' ? '' : body, CONTENT_TYPES.get(extname(target).toLowerCase()) || 'application/octet-stream');
    } catch {
      return sendText(response, 404, 'Not found', 'text/plain; charset=utf-8');
    }
  });
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  const port = Number(process.env.TIM_DEMO_PORT ?? 4173);
  createDemoServer().listen(port, '127.0.0.1', () => {
    console.log(`Tim demo: http://127.0.0.1:${port}`);
  });
}
