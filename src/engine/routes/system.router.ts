import { Router } from 'express';

export const systemRouter = Router();

systemRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.2.0',
    service: 'ZGalaxy Planet/Moon Infrastructure Engine',
  });
});

systemRouter.get('/metrics', (req, res) => {
  res.json({
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    timestamp: new Date().toISOString(),
  });
});
