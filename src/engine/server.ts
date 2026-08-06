import { app } from './app';
import { config } from './config';
import { DDNSService } from '../services/ddnsService';
import { CloudflareService } from '../services/dns/cloudflareService';
import { UserService } from '../services/userService';
import { closeSqliteStore } from '../services/sqliteStore';

const WORKER_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let ddnsTimer: NodeJS.Timeout | null = null;
let cfTimer: NodeJS.Timeout | null = null;
let sessionSweepTimer: NodeJS.Timeout | null = null;
let ddnsRunning = false;
let cfRunning = false;
let sessionSweepRunning = false;
let shuttingDown = false;

// Overlap-guarded worker wrappers: never run two instances of the same worker
// at once, even if a cycle takes longer than the interval.
async function runDdnsWorker(): Promise<void> {
  if (ddnsRunning || shuttingDown) return;
  ddnsRunning = true;
  try {
    const syncResult = await DDNSService.checkAndSyncDDNS();
    if (syncResult.changed) {
      console.log(`[ZGALAXY DDNS WORKER] ${syncResult.message}`);
    }
  } catch (err: any) {
    console.error(`[ZGALAXY DDNS ERROR] ${err.message}`);
  } finally {
    ddnsRunning = false;
  }
}

async function runCfWorker(): Promise<void> {
  if (cfRunning || shuttingDown) return;
  cfRunning = true;
  try {
    const cfResult = await CloudflareService.syncDNS(false);
    if (cfResult.synced) {
      console.log(`[ZGALAXY CLOUDFLARE WORKER] ${cfResult.message}`);
    }
  } catch (err: any) {
    console.error(`[ZGALAXY CLOUDFLARE ERROR] ${err.message}`);
  } finally {
    cfRunning = false;
  }
}

// Hourly GC of expired sessions so the store never grows unboundedly.
async function runSessionSweep(): Promise<void> {
  if (sessionSweepRunning || shuttingDown) return;
  sessionSweepRunning = true;
  try {
    const removed = await UserService.sweepExpiredSessions();
    if (removed > 0) console.log(`[ZGALAXY SESSION SWEEP] Removed ${removed} expired session(s).`);
  } catch (err: any) {
    console.error(`[ZGALAXY SESSION SWEEP ERROR] ${err.message}`);
  } finally {
    sessionSweepRunning = false;
  }
}

const server = app.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`ZGalaxy Planet/Moon Infrastructure Engine Running!`);
  console.log(`Port: ${config.port}`);
  console.log(`Interactive API Specs: http://localhost:${config.port}/api/docs`);
  console.log(`=======================================================`);

  // First run at boot, then on fixed intervals.
  runDdnsWorker();
  runCfWorker();
  runSessionSweep();
  ddnsTimer = setInterval(runDdnsWorker, WORKER_INTERVAL_MS);
  cfTimer = setInterval(runCfWorker, WORKER_INTERVAL_MS);
  sessionSweepTimer = setInterval(runSessionSweep, SESSION_SWEEP_INTERVAL_MS);
});

// HTTP hardening / latency bounds (also limits slowloris-style abuse).
try {
  server.keepAliveTimeout = 65_000;
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
} catch {
  // not supported on all runtimes (Bun)
}

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ZGALAXY FATAL] Port ${config.port} is already in use.`);
  } else if (err.code === 'EACCES') {
    console.error(`[ZGALAXY FATAL] Permission denied binding port ${config.port}.`);
  } else {
    console.error('[ZGALAXY FATAL] Server error:', err);
  }
  process.exit(1);
});

/**
 * Graceful shutdown: stop accepting connections, flush in-flight requests,
 * stop periodic workers, then exit. Idempotent under repeated signals.
 */
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[ZGALAXY SHUTDOWN] Received ${signal}; shutting down gracefully...`);

  if (ddnsTimer) clearInterval(ddnsTimer);
  if (cfTimer) clearInterval(cfTimer);
  if (sessionSweepTimer) clearInterval(sessionSweepTimer);

  const forceTimer = setTimeout(() => {
    console.error('[ZGALAXY SHUTDOWN] Forcing exit after timeout.');
    process.exit(1);
  }, 15 * 1000);
  forceTimer.unref();

  closeSqliteStore();

  try {
    server.closeIdleConnections();
  } catch {
    // not supported on all runtimes
  }

  server.close(() => {
    clearTimeout(forceTimer);
    console.log('[ZGALAXY SHUTDOWN] Server closed cleanly.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason: any) => {
  console.error('[ZGALAXY] Unhandled promise rejection:', reason);
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (err: Error) => {
  console.error('[ZGALAXY] Uncaught exception:', err);
  shutdown('uncaughtException');
});

export { server };
