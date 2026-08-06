import { Router } from 'express';
import { DDNSService } from '../../services/ddnsService';
import { requireRole } from '../rbac';

const maskToken = (token: string | undefined): string => {
  if (!token) return '';
  if (token.length <= 8) return '********';
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
};

const sanitizeConfig = (cfg: any): any => {
  const { providerToken, ...rest } = cfg;
  return { ...rest, providerTokenMasked: maskToken(providerToken), hasProviderToken: Boolean(providerToken) };
};

export const ddnsRouter = Router();

ddnsRouter.get('/status', async (req, res, next) => {
  try {
    const config = await DDNSService.getConfig();
    res.json({ success: true, data: sanitizeConfig(config) });
  } catch (err) {
    next(err);
  }
});

ddnsRouter.post('/sync', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const result = await DDNSService.checkAndSyncDDNS();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

ddnsRouter.post('/config', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const updated = await DDNSService.updateConfig(req.body);
    res.json({ success: true, data: sanitizeConfig(updated) });
  } catch (err: any) {
    // Validation failures are client errors -> 400.
    res.status(400).json({ success: false, error: err.message || 'DDNS config update failed.' });
  }
});
