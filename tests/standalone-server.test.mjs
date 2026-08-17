import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createDemoServer, resolvePublicFile } from '../scripts/serve-demo.mjs';

let server;
let baseUrl;

before(async () => {
  server = createDemoServer({
    aiHandler: (_request, response) => {
      response.writeHead(501, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'test handler' }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('只公开 Standalone 页面和必要运行时资源', async () => {
  assert.ok(resolvePublicFile('/apps/demo/standalone.html'));
  assert.ok(resolvePublicFile('/packages/web-component/assets/tim-six-state/shared/idle/00.png'));
  assert.equal(resolvePublicFile('/apps/demo/component.html'), null);
  assert.equal(resolvePublicFile('/apps/demo/index.html'), null);
  assert.equal(resolvePublicFile('/apps/demo/galaxy.html'), null);

  const standalone = await fetch(`${baseUrl}/standalone`);
  assert.equal(standalone.status, 200);
  assert.match(await standalone.text(), /tim-workbench/);

  for (const path of ['/', '/component', '/galaxy']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 404, `${path} should not be exposed`);
  }
});

test('提供 TIM 角色运行时素材', async () => {
  const response = await fetch(`${baseUrl}/packages/web-component/assets/tim-six-state/shared/idle/00.png`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
});
