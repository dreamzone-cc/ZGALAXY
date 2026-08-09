import { Router } from 'express';
import { config } from '../config';
import { FileManager } from '../../services/fileManager';
import { PlanetService } from '../../services/planetService';
import path from 'path';
import pkg from '../../../package.json';

export const systemRouter = Router();

// Liveness: the process is up and serving.
systemRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: pkg.version,
    service: 'ZGalaxy Planet/Moon Infrastructure Engine',
  });
});

// Readiness: reflects the real state of the ZeroTier infrastructure the engine
// depends on (identity present, planet configured) plus basic reachability.
systemRouter.get('/ready', async (req, res, next) => {
  try {
    const identityExists = await FileManager.fileExists(path.join(config.ztVarPath, 'identity.public'));
    const authTokenExists = await FileManager.fileExists(path.join(config.ztVarPath, 'authtoken.secret'));
    const planetInfo = await PlanetService.getPlanetInfo();

    const ready = identityExists && authTokenExists;
    res.status(ready ? 200 : 503).json({
      ready,
      timestamp: new Date().toISOString(),
      checks: {
        identity: identityExists,
        zerotierAuthToken: authTokenExists,
        planetConfigured: planetInfo.planetExists,
        planetStatus: planetInfo.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

systemRouter.get('/metrics', (req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const cpu = process.cpuUsage();
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send([
    `# HELP zgalaxy_uptime_seconds Process uptime in seconds`,
    `# TYPE zgalaxy_uptime_seconds gauge`,
    `zgalaxy_uptime_seconds ${uptime}`,
    `# HELP zgalaxy_process_rss_bytes Resident set size`,
    `# TYPE zgalaxy_process_rss_bytes gauge`,
    `zgalaxy_process_rss_bytes ${mem.rss}`,
    `# HELP zgalaxy_process_heap_used_bytes Heap used`,
    `# TYPE zgalaxy_process_heap_used_bytes gauge`,
    `zgalaxy_process_heap_used_bytes ${mem.heapUsed}`,
    `# HELP zgalaxy_process_heap_total_bytes Heap total`,
    `# TYPE zgalaxy_process_heap_total_bytes gauge`,
    `zgalaxy_process_heap_total_bytes ${mem.heapTotal}`,
    `# HELP zgalaxy_process_external_bytes External memory`,
    `# TYPE zgalaxy_process_external_bytes gauge`,
    `zgalaxy_process_external_bytes ${mem.external}`,
    `# HELP zgalaxy_process_cpu_user_ms User CPU time`,
    `# TYPE zgalaxy_process_cpu_user_ms counter`,
    `zgalaxy_process_cpu_user_ms ${cpu.user}`,
    `# HELP zgalaxy_process_cpu_system_ms System CPU time`,
    `# TYPE zgalaxy_process_cpu_system_ms counter`,
    `zgalaxy_process_cpu_system_ms ${cpu.system}`,
    `# HELP zgalaxy_version Build version`,
    `# TYPE zgalaxy_version gauge`,
    `zgalaxy_version 1`,
  ].join('\n') + '\n');
});
