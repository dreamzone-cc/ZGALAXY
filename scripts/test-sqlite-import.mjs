// Behavioral verification of the sqlite sessions/users import fix (bun).
process.env.CONFIG_PATH = '/tmp/zgtest-config';
process.env.USE_SQLITE = '1';
const fs = await import('fs');
fs.rmSync('/tmp/zgtest-config', { recursive: true, force: true });
fs.mkdirSync('/tmp/zgtest-config', { recursive: true });
fs.writeFileSync('/tmp/zgtest-config/users.json', JSON.stringify([
  { username: 'alice', passwordHash: 'h', salt: 's', role: 'ADMIN', createdAt: '2026-01-01' },
  { username: 'bad', passwordHash: 'h', salt: 's', role: 'lowercase_admin', createdAt: '2026-01-01' },
]));
fs.writeFileSync('/tmp/zgtest-config/sessions.json', JSON.stringify([
  { token: 't-alice', username: 'alice', role: 'ADMIN', createdAt: '2026-01-01' },
  { token: 't-orphan', username: 'ghost', role: 'ADMIN', createdAt: '2026-01-01' },
  { token: 't-badrole', username: 'alice', role: 'SUPERUSER', createdAt: '2026-01-01' },
]));
const { SqliteAuthStore } = await import(new URL('../src/services/sqliteStore.ts', import.meta.url).pathname);
await SqliteAuthStore.init();
const db = SqliteAuthStore.db;
const users = db.prepare('SELECT username FROM users').all().map(r => r.username);
const sessions = db.prepare('SELECT token FROM sessions').all().map(r => r.token);
console.log('users:', JSON.stringify(users));
console.log('sessions:', JSON.stringify(sessions));
const fail = [];
// users.json import fails on the bad row → whole users import rolls back →
// seed must still provide a loginable admin (fix #2).
const loginable = users.includes('admin') || users.includes('alice');
if (!loginable) fail.push('no loginable user after partial users.json import');
if (users.includes('bad')) fail.push('CHECK-violating user present (expected rollback)');
// Valid session must survive even with orphan/bad-role rows present (fix #1).
if (!sessions.includes('t-alice')) fail.push('valid session lost (import still all-or-nothing)');
if (sessions.includes('t-orphan')) fail.push('orphan session imported');
if (sessions.includes('t-badrole')) fail.push('bad-role session imported');
if (fail.length) { console.error('FAIL:', fail.join('; ')); process.exit(1); }
console.log('FK-IMPORT-FIX: PASS');
