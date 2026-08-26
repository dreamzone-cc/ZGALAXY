import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { SyncTokenService } from '../../services/syncTokenService';
import { FileManager } from '../../services/fileManager';
import { config } from '../config';
import { requireRole } from '../rbac';

export const syncRouter = Router();

function getDistPath(): string {
  return process.env.DIST_PATH || config.distPath;
}

// Helper to compute sha256 of a file on disk
async function getFileSha256(filePath: string): Promise<string | null> {
  if (!(await FileManager.fileExists(filePath))) return null;
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

// GET /api/v1/sync/manifest (Client Dynamic Manifest Endpoint)
syncRouter.get('/manifest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokenSecret = (req.headers['x-zgalaxy-signature'] as string) || '';
    const deviceFp = (req.headers['x-device-fingerprint'] as string) || '';

    const authRes = await SyncTokenService.validateAndRegisterDevice(tokenSecret, deviceFp);
    if (!authRes.valid) {
      return res.status(authRes.statusCode || 401).json({ success: false, error: authRes.error });
    }

    const distPath = getDistPath();
    const planets = [];
    const planetPath = path.join(distPath, 'planet');
    if (await FileManager.fileExists(planetPath)) {
      const sha256 = await getFileSha256(planetPath);
      const stat = await fs.stat(planetPath);
      planets.push({
        id: 'earth',
        world_type: 1,
        filename: 'planet',
        sha256,
        size_bytes: stat.size,
        timestamp: Math.floor(stat.mtimeMs),
        download_url: '/api/v1/sync/download/planet/earth',
      });
    }

    const moons = [];
    const files = await FileManager.listFiles(distPath);
    for (const f of files) {
      if (f.endsWith('.moon')) {
        const moonPath = path.join(distPath, f);
        const sha256 = await getFileSha256(moonPath);
        const stat = await fs.stat(moonPath);
        const moonId = f.replace('.moon', '');
        moons.push({
          id: moonId,
          world_type: 127,
          filename: f,
          sha256,
          size_bytes: stat.size,
          timestamp: Math.floor(stat.mtimeMs),
          download_url: `/api/v1/sync/download/moon/${moonId}`,
        });
      }
    }

    const manifestData = {
      version: 1,
      issued_at: Math.floor(Date.now() / 1000),
      refresh_interval_sec: 3600,
      planets,
      moons,
    };

    const manifestHash = crypto.createHash('sha256').update(JSON.stringify(manifestData)).digest('hex');
    const etag = `"${manifestHash}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('ETag', etag);
    res.json(manifestData);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/sync/download/:type/:id (Download binary assets)
syncRouter.get('/download/:type/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokenSecret = (req.headers['x-zgalaxy-signature'] as string) || '';
    const deviceFp = (req.headers['x-device-fingerprint'] as string) || '';

    const authRes = await SyncTokenService.validateAndRegisterDevice(tokenSecret, deviceFp);
    if (!authRes.valid) {
      return res.status(authRes.statusCode || 401).json({ success: false, error: authRes.error });
    }

    const distPath = getDistPath();
    const { type, id } = req.params;
    let targetPath = '';

    if (type === 'planet') {
      targetPath = path.join(distPath, 'planet');
    } else if (type === 'moon') {
      targetPath = path.join(distPath, `${id}.moon`);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid asset type.' });
    }

    if (!(await FileManager.fileExists(targetPath))) {
      return res.status(404).json({ success: false, error: 'Topology asset not found on server.' });
    }

    res.download(targetPath);
  } catch (err) {
    next(err);
  }
});

// Admin management routes
syncRouter.get('/tokens', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = await SyncTokenService.listTokens();
    res.json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
});

syncRouter.post('/tokens/create', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await SyncTokenService.createToken(req.body);
    res.status(201).json({ success: true, data: token });
  } catch (err) {
    next(err);
  }
});

syncRouter.post('/tokens/:id/revoke', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await SyncTokenService.revokeToken(req.params.id);
    res.json({ success: true, data: token });
  } catch (err) {
    next(err);
  }
});
