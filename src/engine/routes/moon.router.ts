import { Router } from 'express';
import { MoonService } from '../../services/moonService';
import { MoonMigrationService } from '../../services/moonMigrationService';
import { requireRole } from '../rbac';

export const moonRouter = Router();

moonRouter.get('/', async (req, res, next) => {
  try {
    const moons = await MoonService.listMoons();
    res.json({ success: true, data: moons });
  } catch (err) {
    next(err);
  }
});

moonRouter.post('/create', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const result = await MoonService.createMoon(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    if (err && /endpoints|Invalid Moon endpoint/i.test(err.message)) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

moonRouter.put('/:id', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const result = await MoonService.updateMoon(req.params.id, req.body.endpoints);
    res.json(result);
  } catch (err: any) {
    if (err && /endpoints|Invalid Moon endpoint|does not match/i.test(err.message)) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

moonRouter.post('/:id/migrate', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { targetPlanetId } = req.body;
    if (!targetPlanetId) {
      res.status(400).json({ success: false, error: 'targetPlanetId is required for Moon migration.' });
      return;
    }
    const result = await MoonMigrationService.migrateMoon(req.params.id, targetPlanetId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

moonRouter.post('/:id/rebind', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { endpoints } = req.body;
    if (!Array.isArray(endpoints) || endpoints.length === 0) {
      res.status(400).json({ success: false, error: 'endpoints array is required for Moon re-binding.' });
      return;
    }
    const result = await MoonMigrationService.rebindMoonEndpoints(req.params.id, endpoints);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

moonRouter.post('/:id/rebuild', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const result = await MoonService.rebuildMoon(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

moonRouter.get('/:id/download', async (req, res, next) => {
  try {
    const filePath = await MoonService.getMoonFilePath(req.params.id);
    res.download(filePath);
  } catch (err: any) {
    if (err && err.message && err.message.startsWith('Invalid Moon identifier')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

moonRouter.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const result = await MoonService.deleteMoon(req.params.id);
    res.json(result);
  } catch (err: any) {
    if (err && err.message && err.message.startsWith('Invalid Moon identifier')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

moonRouter.get('/ha-templates', (req, res) => {
  res.json({ success: true, data: MoonService.getHATemplates() });
});
