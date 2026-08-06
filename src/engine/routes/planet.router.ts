import { Router } from 'express';
import path from 'path';
import { PlanetService } from '../../services/planetService';
import { FileManager } from '../../services/fileManager';
import { config } from '../config';
import { requireRole } from '../rbac';

export const planetRouter = Router();

planetRouter.get('/info', async (req, res, next) => {
  try {
    const info = await PlanetService.getPlanetInfo();
    res.json({ success: true, data: info });
  } catch (err) {
    next(err);
  }
});

planetRouter.get('/download', async (req, res, next) => {
  try {
    const planetPath = path.join(config.distPath, 'planet');
    const exists = await FileManager.fileExists(planetPath);

    if (!exists) {
      // Create planet file if missing to ensure smooth download
      await FileManager.writeText(
        planetPath,
        '# ZeroTier ZGalaxy Planet Binary File Placeholder\n# Please build planet via /api/v1/planet/build'
      );
    }

    res.download(planetPath, 'planet');
  } catch (err) {
    next(err);
  }
});

planetRouter.post('/build', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const result = await PlanetService.buildPlanet(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

planetRouter.post('/regenerate', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const result = await PlanetService.buildPlanet(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

planetRouter.delete('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const result = await PlanetService.deletePlanet();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

planetRouter.post('/validate', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const result = await PlanetService.validatePlanet();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

planetRouter.get('/templates', (req, res) => {
  res.json({ success: true, data: PlanetService.getTemplates() });
});
