import { Router } from 'express';
import { CloudflareService } from '../../services/dns/cloudflareService';

export const cloudflareRouter = Router();

// Helper to mask sensitive token
const maskToken = (token: string): string => {
  if (!token) return '';
  if (token.length <= 8) return '********';
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
};

// GET Cloudflare Configuration
cloudflareRouter.get('/config', async (req, res, next) => {
  try {
    const cfg = await CloudflareService.getConfig();
    res.json({
      success: true,
      data: {
        ...cfg,
        apiTokenMasked: maskToken(cfg.apiToken),
        hasApiToken: Boolean(cfg.apiToken && cfg.apiToken.trim().length > 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST Save / Update Cloudflare Configuration
cloudflareRouter.post('/config', async (req, res, next) => {
  try {
    const { enabled, mode, apiToken, zoneId, zoneName, recordId, recordName, recordType, proxied, autoRebuildPlanet } = req.body;

    const currentCfg = await CloudflareService.getConfig();

    const updatePayload: any = {};
    if (enabled !== undefined) updatePayload.enabled = Boolean(enabled);
    if (mode) updatePayload.mode = mode;
    if (apiToken !== undefined && apiToken !== 'KEEP_SAME') updatePayload.apiToken = apiToken;
    if (zoneId !== undefined) updatePayload.zoneId = zoneId;
    if (zoneName !== undefined) updatePayload.zoneName = zoneName.trim();
    if (recordId !== undefined) updatePayload.recordId = recordId;
    if (recordName !== undefined) updatePayload.recordName = recordName.trim();
    if (recordType) updatePayload.recordType = recordType;
    if (proxied !== undefined) updatePayload.proxied = Boolean(proxied);
    if (autoRebuildPlanet !== undefined) updatePayload.autoRebuildPlanet = Boolean(autoRebuildPlanet);

    const saved = await CloudflareService.saveConfig(updatePayload);

    res.json({
      success: true,
      message: 'Cloudflare configuration saved successfully.',
      data: {
        ...saved,
        apiTokenMasked: maskToken(saved.apiToken),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST Verify API Token Validity
cloudflareRouter.post('/verify-token', async (req, res, next) => {
  try {
    const { apiToken } = req.body;
    const cfg = await CloudflareService.getConfig();
    const tokenToTest = apiToken && apiToken !== 'KEEP_SAME' ? apiToken : cfg.apiToken;

    if (!tokenToTest) {
      return res.status(400).json({ success: false, error: 'API Token is required for verification.' });
    }

    const isValid = await CloudflareService.verifyToken(tokenToTest);
    res.json({
      success: true,
      isValid,
      message: isValid ? 'Cloudflare API Token is valid and active.' : 'Invalid or expired Cloudflare API Token.',
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET Fetch Available Zones (Domains)
cloudflareRouter.get('/zones', async (req, res, next) => {
  try {
    const tokenHeader = req.headers['x-cloudflare-token'] as string;
    const zones = await CloudflareService.getZones(tokenHeader);
    res.json({ success: true, data: zones });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET Fetch Records for a Zone
cloudflareRouter.get('/zones/:zoneId/records', async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    const tokenHeader = req.headers['x-cloudflare-token'] as string;
    const records = await CloudflareService.getRecords(zoneId, tokenHeader);
    res.json({ success: true, data: records });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST Trigger Manual Synchronization
cloudflareRouter.post('/sync', async (req, res, next) => {
  try {
    const result = await CloudflareService.syncDNS(true);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET Fetch Synchronization History Logs
cloudflareRouter.get('/logs', async (req, res, next) => {
  try {
    const logs = await CloudflareService.getLogs();
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
});

// DELETE Clear Cloudflare Synchronization Logs
cloudflareRouter.delete('/logs', async (req, res, next) => {
  try {
    await CloudflareService.clearLogs();
    res.json({ success: true, message: 'Cloudflare sync history logs cleared successfully.' });
  } catch (err) {
    next(err);
  }
});
