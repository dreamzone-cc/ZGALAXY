'use strict';
// Security regression tests: RBAC, SSRF, path traversal, command injection.
// Run after `npm run build` (requires dist_engine/). Uses node:test + fetch.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Isolated runtime dirs so tests never touch the real config.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zgalaxy-test-'));
process.env.CONFIG_PATH = path.join(tmpRoot, 'config');
process.env.DIST_PATH = path.join(tmpRoot, 'dist');
process.env.ZT_VAR_PATH = path.join(tmpRoot, 'ztvar');
process.env.APP_PATH = tmpRoot;
process.env.ENGINE_PORT = '0';
process.env.CORS_ORIGINS = 'http://localhost:5173';

for (const d of ['config', 'dist', 'ztvar']) {
  fs.mkdirSync(path.join(tmpRoot, d), { recursive: true });
}

// Since commit 48736cd the repo no longer bundles ZeroTier C++ binaries; the
// engine shells out to the zgalaxy-rs multi-call binary (argv0 dispatch).
// Tests that compile planets/moons require those tools — either explicit env
// overrides or an installed zgalaxy-rs providing them on PATH.
function hasCliTool(binName) {
  if (process.env.MKMOONWORLD_PATH && binName.startsWith('mkmoon')) return fs.existsSync(process.env.MKMOONWORLD_PATH);
  if (process.env.IDTOOL_PATH && binName.startsWith('zerotier-idtool')) return fs.existsSync(process.env.IDTOOL_PATH);
  const dirs = (process.env.PATH || '').split(path.delimiter);
  return dirs.some((d) => fs.existsSync(path.join(d, binName)));
}
const HAS_PLANET_TOOLCHAIN =
  hasCliTool('mkmoonworld-x86_64') && hasCliTool('zerotier-idtool');

const { app } = require(path.join(ROOT, 'dist_engine', 'engine', 'app.js'));
const { UserService } = require(path.join(ROOT, 'dist_engine', 'services', 'userService.js'));

let server;
let base;
let adminToken;
let readerToken;
const secretFile = path.join(tmpRoot, 'secret_file.txt');
const planetFile = path.join(tmpRoot, 'dist', 'planet');

function req(method, p, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
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

  // Bootstrap admin + reader accounts (avoid the auto-seeded default 'admin').
  await UserService.createUser('testadmin', 'AdminPass1!', 'ADMIN');
  await UserService.createUser('testreader', 'ReaderPass1!', 'READ_ONLY');

  const login = async (u, p) => {
    const res = await req('POST', '/api/v1/auth/login', { body: { username: u, password: p } });
    const data = await res.json();
    return data.data.token;
  };
  adminToken = await login('testadmin', 'AdminPass1!');
  readerToken = await login('testreader', 'ReaderPass1!');

  fs.writeFileSync(secretFile, 'TOPSECRET');
  fs.writeFileSync(planetFile, 'PLANETBINARYDATA');
});

after(() => {
  server.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('RBAC: unauthenticated access to protected routes returns 401', async () => {
  const res = await req('GET', '/api/v1/auth/users');
  assert.strictEqual(res.status, 401);
});

test('RBAC: READ_ONLY cannot perform admin state-changing operations (403)', async () => {
  const cases = [
    ['POST', '/api/v1/auth/users/create', { username: 'x', password: 'Passw0rd1', role: 'ADMIN' }],
    ['DELETE', '/api/v1/planet', null],
    ['POST', '/api/v1/planet/build', { ip4: '203.0.113.5' }],
    ['POST', '/api/v1/cluster/sync', null],
    ['POST', '/api/v1/moons/create', { endpoints: ['203.0.113.5/9994'] }],
    ['POST', '/api/v1/backup/export', null],
  ];
  for (const [m, p, b] of cases) {
    const res = await req(m, p, { token: readerToken, body: b });
    assert.strictEqual(res.status, 403, `${m} ${p} should be 403 for READ_ONLY`);
  }
});

test('RBAC: READ_ONLY can still read non-sensitive data (200)', async () => {
  const res = await req('GET', '/api/v1/planet/info', { token: readerToken });
  assert.strictEqual(res.status, 200);
});

test('RBAC: invalid role is rejected at user creation (400)', async () => {
  const res = await req('POST', '/api/v1/auth/users/create', {
    token: adminToken,
    body: { username: 'evil', password: 'Passw0rd1', role: 'SUPERADMIN' },
  });
  assert.strictEqual(res.status, 400);
});

test('RBAC: the admin account cannot be deleted', async () => {
  const res = await req('DELETE', '/api/v1/auth/users/admin', { token: adminToken });
  assert.strictEqual(res.status, 400);
});

test('C2/C3: default secret key no longer grants access', async () => {
  const res = await req('GET', '/api/v1/planet/info', { token: 'zerotier_planet_secret_key_default_123' });
  assert.strictEqual(res.status, 401);
});

test('C5/M9: cloudflare config never leaks the raw apiToken', async () => {
  const res = await req('GET', '/api/v1/cloudflare/config', { token: adminToken });
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.ok(!('apiToken' in data.data), 'raw apiToken must not be returned');
  assert.ok('apiTokenMasked' in data.data);
});

test('H2: moon path traversal is rejected and cannot delete arbitrary files', async () => {
  const res = await req('DELETE', `/api/v1/moons/..%2F${path.basename(secretFile)}`, { token: adminToken });
  assert.strictEqual(res.status, 400);
  assert.ok(fs.existsSync(secretFile), 'secret file must be untouched');
});

test('H2: moon download traversal is rejected', async () => {
  const res = await req('GET', `/api/v1/moons/..%2Fsecret_file.txt/download`, { token: adminToken });
  assert.strictEqual(res.status, 400);
});

test('H1: federation join blocks localhost (SSRF)', async () => {
  const res = await req('POST', '/api/v1/federation/join', {
    token: adminToken,
    body: { targetEndpoint: 'http://127.0.0.1:9994', tokenSecret: 'anything' },
  });
  const data = await res.json();
  assert.strictEqual(res.status, 400);
  assert.match(data.error, /Blocked|not allowed/i);
});

test('H1: federation join blocks cloud metadata IP (SSRF)', async () => {
  const res = await req('POST', '/api/v1/federation/join', {
    token: adminToken,
    body: { targetEndpoint: 'http://169.254.169.254/latest/meta-data', tokenSecret: 'anything' },
  });
  const data = await res.json();
  assert.strictEqual(res.status, 400);
  assert.match(data.error, /Blocked|not allowed/i);
});

test('H1: federation handshake rejects internal source endpoints (topology poisoning)', async () => {
  const res = await req('POST', '/api/v1/federation/handshake', {
    body: {
      sourceNodeId: 'node_x',
      sourceEndpoint: 'http://10.0.0.1:3000',
      tokenSecret: 'invalid',
    },
  });
  const data = await res.json();
  assert.strictEqual(data.success, false);
});

test('H3: backup import rejects non-gzip junk files', async () => {
  const junk = path.join(tmpRoot, 'config', 'junk.txt');
  fs.writeFileSync(junk, 'not a gzip archive');
  const res = await req('POST', '/api/v1/backup/import', {
    token: adminToken,
    body: { tarPath: junk },
  });
  const data = await res.json();
  assert.strictEqual(res.status, 400);
  assert.strictEqual(data.success, false);
  assert.match(data.error, /gzip/i);
});

test('H5: login rate limiter returns 429 after repeated attempts', async () => {
  let lastStatus = 0;
  for (let i = 0; i < 25; i++) {
    const res = await req('POST', '/api/v1/auth/login', {
      body: { username: 'admin', password: 'WrongPass1' },
    });
    lastStatus = res.status;
    if (lastStatus === 429) break;
  }
  assert.strictEqual(lastStatus, 429);
});

test('H4: logout invalidates the session token', async () => {
  const res = await req('GET', '/api/v1/planet/info', { token: readerToken });
  assert.strictEqual(res.status, 200);
  await req('POST', '/api/v1/auth/logout', { token: readerToken });
  const res2 = await req('GET', '/api/v1/planet/info', { token: readerToken });
  assert.strictEqual(res2.status, 401);
});

// ---------- Round-2 deep-inspection regression tests ----------

// B1: verification delegates to the zgalaxy-rs idtool (`validate`). The
// authoritative positive case is therefore an identity generated BY that
// toolchain — not a JS-fabricated hash approximation.
const HAS_IDTOOL =
  (process.env.IDTOOL_PATH && fs.existsSync(process.env.IDTOOL_PATH)) ||
  (process.env.PATH || '').split(path.delimiter).some((d) => fs.existsSync(path.join(d, 'zerotier-idtool')));
(HAS_IDTOOL ? test : test.skip)('R2: identity verification validates a real idtool-generated identity', async () => {
  const genRes = await req('POST', '/api/v1/identity/generate', { token: adminToken });
  const genData = await genRes.json();
  assert.strictEqual(genRes.status, 200);
  assert.strictEqual(genData.certificateStatus, 'VALID');

  const res = await req('POST', '/api/v1/identity/verify', { token: adminToken });
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.data.verified, true);
  assert.strictEqual(data.data.certificateStatus, 'VALID');
});

test('R2: cluster removeNode keeps the local primary node', async () => {
  const add = await req('POST', '/api/v1/cluster/nodes/add', {
    token: adminToken,
    body: { nodeId: 'remote1', ip4: '203.0.113.50' },
  });
  assert.strictEqual(add.status, 201);
  const del = await req('DELETE', '/api/v1/cluster/nodes/remote1', { token: adminToken });
  assert.strictEqual(del.status, 200);
  const status = await req('GET', '/api/v1/cluster/status', { token: adminToken });
  const data = (await status.json()).data;
  assert.ok(data.nodes.some((n) => n.isLocal), 'local primary must survive removeNode');
  assert.ok(!data.nodes.some((n) => n.nodeId === 'remote1'));
});

test('R2: cluster node add rejects private/reserved IPs (SSRF oracle)', async () => {
  const res = await req('POST', '/api/v1/cluster/nodes/add', {
    token: adminToken,
    body: { nodeId: 'evil', ip4: '10.0.0.5' },
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /Blocked/i);
});

test('R2: ddns/status masks providerToken', async () => {
  const res = await req('GET', '/api/v1/ddns/status', { token: adminToken });
  const data = (await res.json()).data;
  assert.ok(!('providerToken' in data), 'raw providerToken must not leak');
  assert.ok('providerTokenMasked' in data);
});

test('R2: malformed JSON returns 400 not 500', async () => {
  const res = await fetch(base + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
  });
  assert.strictEqual(res.status, 400);
});

test('R2: unknown API path returns JSON 404', async () => {
  const res = await req('GET', '/api/v1/does-not-exist', { token: adminToken });
  assert.strictEqual(res.status, 404);
  assert.strictEqual((await res.json()).success, false);
});

// ---------- Round-3 performance & storage regression tests ----------

test('R3: SQLite is the default auth store when the runtime supports it', async () => {
  const { SqliteAuthStore } = require(path.join(ROOT, 'dist_engine', 'services', 'sqliteStore.js'));
  assert.strictEqual(SqliteAuthStore.isEnabled(), true, 'SQLite should be enabled by default on Bun/Node>=22.5');
});

test('R3: session sweep removes expired sessions', async () => {
  // Mint a stale session in whichever store is active, then sweep.
  const { UserService } = require(path.join(ROOT, 'dist_engine', 'services', 'userService.js'));
  const { SqliteAuthStore } = require(path.join(ROOT, 'dist_engine', 'services', 'sqliteStore.js'));
  const staleCreatedAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  if (SqliteAuthStore.isEnabled()) {
    await SqliteAuthStore.init();
    SqliteAuthStore.db
      .prepare('INSERT OR IGNORE INTO sessions (token, username, role, created_at) VALUES (?,?,?,?)')
      .run('stale-token-1', 'testadmin', 'ADMIN', staleCreatedAt);
  } else {
    const sessionsFile = path.join(tmpRoot, 'config', 'sessions.json');
    fs.writeFileSync(sessionsFile, JSON.stringify([
      { token: 'stale-token-1', username: 'testadmin', role: 'ADMIN', createdAt: staleCreatedAt },
    ]));
  }
  const removed = await UserService.sweepExpiredSessions();
  assert.ok(removed >= 1, 'sweep should remove at least the stale session');
});

test('R3: streaming backup export/import roundtrip (constant-memory path)', async () => {
  fs.writeFileSync(path.join(tmpRoot, 'ztvar', 'roundtrip.txt'), 'roundtrip-data');
  const exp = await req('POST', '/api/v1/backup/export', { token: adminToken });
  const expData = await exp.json();
  assert.strictEqual(expData.success, true);
  assert.strictEqual(expData.encrypted, true);
  assert.ok(expData.backupPath.endsWith('.enc'));

  fs.unlinkSync(path.join(tmpRoot, 'ztvar', 'roundtrip.txt'));
  const imp = await req('POST', '/api/v1/backup/import', { token: adminToken, body: { tarPath: expData.backupPath } });
  const impData = await imp.json();
  assert.strictEqual(impData.success, true);
  assert.strictEqual(impData.encrypted, true);
  assert.strictEqual(fs.readFileSync(path.join(tmpRoot, 'ztvar', 'roundtrip.txt'), 'utf8'), 'roundtrip-data');
});

// ---------- Round-4 Deep Audit Fixes Regression Tests ----------

test('R4: GET /install.sh is public and serves automated installer', async () => {
  const res = await req('GET', '/install.sh');
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('ZGALAXY One — Sovereign ZeroTier Client Installer'));
  assert.ok(text.includes('/usr/local/bin/zgalaxy-rs'));
});

test('R4: federation handshake under concurrent requests persists all peers', async () => {
  const tokenRes = await req('POST', '/api/v1/federation/tokens/create', {
    token: adminToken,
    body: { name: 'race_test_token', syncMode: 'FEDERATION_INHERITED', maxUses: 50 },
  });
  const tokenData = (await tokenRes.json()).data;
  assert.ok(tokenData && tokenData.tokenSecret);

  // Send 6 concurrent handshakes with unique node IDs
  const parallelHandshakes = Array.from({ length: 6 }, (_, i) => {
    return req('POST', '/api/v1/federation/handshake', {
      body: {
        sourceNodeId: `node_race_${i}_${Date.now().toString(36)}`,
        sourceNodeName: `Concurrent Test Node ${i}`,
        sourceEndpoint: `http://198.51.100.${10 + i}:3000`,
        tokenSecret: tokenData.tokenSecret,
        requestedSyncMode: 'FEDERATION_INHERITED',
      },
    });
  });

  const responses = await Promise.all(parallelHandshakes);
  for (const r of responses) {
    const json = await r.json();
    assert.strictEqual(json.success, true);
  }

  const peersRes = await req('GET', '/api/v1/federation/peers', { token: adminToken });
  const peersData = (await peersRes.json()).data;
  assert.ok(peersData.peers.length >= 6, 'All concurrent peers must be persisted without race loss');
});

(HAS_PLANET_TOOLCHAIN ? test : test.skip)('R4: cluster build-unified succeeds out-of-the-box with local node', async () => {
  const buildRes = await req('POST', '/api/v1/cluster/build-unified', { token: adminToken });
  const buildData = await buildRes.json();
  assert.strictEqual(buildRes.status, 200);
  assert.strictEqual(buildData.success, true);
});
