'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zgalaxy-sync-test-'));
process.env.CONFIG_PATH = path.join(tmpRoot, 'config');
process.env.DIST_PATH = path.join(tmpRoot, 'dist');
process.env.ZT_VAR_PATH = path.join(tmpRoot, 'ztvar');
process.env.APP_PATH = tmpRoot;
process.env.ENGINE_PORT = '0';

for (const d of ['config', 'dist', 'ztvar']) {
  fs.mkdirSync(path.join(tmpRoot, d), { recursive: true });
}

const { app } = require(path.join(ROOT, 'dist_engine', 'engine', 'app.js'));
const { SyncTokenService } = require(path.join(ROOT, 'dist_engine', 'services', 'syncTokenService.js'));

let server;
let base;
let validToken;
let singleToken;

function syncReq(method, p, { token, fingerprint, ifNoneMatch, body } = {}) {
  const headers = {};
  if (token) headers['X-ZGALAXY-Signature'] = token;
  if (fingerprint) headers['X-Device-Fingerprint'] = fingerprint;
  if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(base + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  fs.writeFileSync(path.join(tmpRoot, 'dist', 'planet'), 'PLANET_TEST_BINARY_DATA');
  fs.writeFileSync(path.join(tmpRoot, 'dist', '000000069ae38092.moon'), 'MOON_TEST_BINARY_DATA');

  validToken = await SyncTokenService.createToken({
    name: 'Test Group Token',
    tokenType: 'group',
    maxDevices: 2,
    expiresInDays: 30,
  });

  singleToken = await SyncTokenService.createToken({
    name: 'Test Single Token',
    tokenType: 'single',
    maxDevices: 1,
    expiresInDays: 30,
  });
});

after(() => {
  if (server) server.close();
});

test('GET /api/v1/sync/manifest rejects request without token (401)', async () => {
  const res = await syncReq('GET', '/api/v1/sync/manifest');
  assert.strictEqual(res.status, 401);
});

test('GET /api/v1/sync/manifest rejects invalid token (401)', async () => {
  const res = await syncReq('GET', '/api/v1/sync/manifest', { token: 'ZG-tok_invalid_fake_key' });
  assert.strictEqual(res.status, 401);
});

test('GET /api/v1/sync/manifest succeeds with valid token (200)', async () => {
  const res = await syncReq('GET', '/api/v1/sync/manifest', {
    token: validToken.tokenSecret,
    fingerprint: 'device_node_alice_1',
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.version, 1);
  assert.strictEqual(data.planets.length, 1);
  assert.strictEqual(data.moons.length, 1);
  assert.ok(res.headers.get('etag'));
});

test('GET /api/v1/sync/manifest returns 304 Not Modified when ETag matches', async () => {
  const res1 = await syncReq('GET', '/api/v1/sync/manifest', {
    token: validToken.tokenSecret,
    fingerprint: 'device_node_alice_1',
  });
  const etag = res1.headers.get('etag');

  const res2 = await syncReq('GET', '/api/v1/sync/manifest', {
    token: validToken.tokenSecret,
    fingerprint: 'device_node_alice_1',
    ifNoneMatch: etag,
  });
  assert.strictEqual(res2.status, 304);
});

test('Single Token enforces strict 1-device quota (403 on 2nd device)', async () => {
  // Device 1 succeeds
  const res1 = await syncReq('GET', '/api/v1/sync/manifest', {
    token: singleToken.tokenSecret,
    fingerprint: 'device_node_single_alpha',
  });
  assert.strictEqual(res1.status, 200);

  // Device 2 fails
  const res2 = await syncReq('GET', '/api/v1/sync/manifest', {
    token: singleToken.tokenSecret,
    fingerprint: 'device_node_single_beta',
  });
  assert.strictEqual(res2.status, 403);
  const errData = await res2.json();
  assert.ok(errData.error.includes('Device limit exceeded'));
});

test('Revoked token is rejected immediately (403)', async () => {
  const token = await SyncTokenService.createToken({
    name: 'To be revoked token',
    expiresInDays: 10,
  });
  await SyncTokenService.revokeToken(token.tokenId);

  const res = await syncReq('GET', '/api/v1/sync/manifest', { token: token.tokenSecret });
  assert.strictEqual(res.status, 403);
});
