import { Router } from 'express';
import { DDNSService } from '../../services/ddnsService';

export const ddnsRouter = Router();

ddnsRouter.get('/status', async (req, res, next) => {
  try {
    const config = await DDNSService.getConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

ddnsRouter.post('/sync', async (req, res, next) => {
  try {
    const result = await DDNSService.checkAndSyncDDNS();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

ddnsRouter.post('/config', async (req, res, next) => {
  try {
    const updated = await DDNSService.updateConfig(req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});
