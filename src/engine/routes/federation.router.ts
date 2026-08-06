import { Router, Request, Response, NextFunction } from 'express';
import { FederationTokenService } from '../../services/federationTokenService';
import { FederationPeerService } from '../../services/federationPeerService';
import { requireRole } from '../rbac';

export const federationRouter = Router();

// PUBLIC UNPROTECTED ROUTE: Inter-Node Handshake Endpoint (Bypasses Bearer auth so peers can exchange tokens)
federationRouter.post('/handshake', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await FederationPeerService.handleIncomingHandshake(req.body);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message || 'Handshake failed' });
  }
});

// GET /api/v1/federation/tokens - List generated tokens
federationRouter.get('/tokens', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = await FederationTokenService.listTokens();
    res.json({ success: true, data: tokens });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/federation/tokens/create - Create a new Federation Token
federationRouter.post('/tokens/create', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await FederationTokenService.createToken(req.body);
    res.status(201).json({ success: true, message: 'Federation Token created successfully.', data: token });
  } catch (error: any) {
    // Missing/Invalid request fields are client errors -> 400.
    res.status(400).json({ success: false, error: error.message || 'Failed to create Federation Token.' });
  }
});

// POST /api/v1/federation/tokens/:id/revoke - Permanently revoke token
federationRouter.post('/tokens/:id/revoke', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await FederationTokenService.revokeToken(req.params.id);
    res.json({ success: true, message: `Token ${req.params.id} revoked successfully.`, data: token });
  } catch (error: any) {
    if (error && /not found/i.test(error.message)) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
});

// POST /api/v1/federation/tokens/:id/renew - Extend token expiration date
federationRouter.post('/tokens/:id/renew', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawDays = (req.body && req.body.extensionDays) || 30;
    const days = Number(rawDays);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return res.status(400).json({ success: false, error: 'extensionDays must be a number between 1 and 3650.' });
    }
    const token = await FederationTokenService.renewToken(req.params.id, days);
    res.json({ success: true, message: `Token ${req.params.id} renewed.`, data: token });
  } catch (error: any) {
    if (error && /not found/i.test(error.message)) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message || 'Failed to renew token.' });
  }
});

// POST /api/v1/federation/join - Join remote ZGALAXY node using Token
federationRouter.post('/join', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { targetEndpoint, tokenSecret, syncMode } = req.body;
    if (!targetEndpoint || !tokenSecret) {
      return res.status(400).json({ success: false, error: 'targetEndpoint and tokenSecret are required.' });
    }
    if (syncMode && !['FEDERATION_INHERITED', 'DIRECT_ISOLATED'].includes(syncMode)) {
      return res.status(400).json({ success: false, error: `Invalid syncMode '${syncMode}'.` });
    }
    const result = await FederationPeerService.joinFederation(targetEndpoint, tokenSecret, syncMode);
    res.json({ success: true, data: result });
  } catch (error: any) {
    // Invalid/blocked targets (SSRF protection) and bad input are client errors -> 400.
    res.status(400).json({ success: false, error: error.message || 'Failed to join federation.' });
  }
});

// GET /api/v1/federation/peers - List active connected peers & topology map
federationRouter.get('/peers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const topology = await FederationPeerService.getPeerTopology();
    res.json({ success: true, data: topology });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/federation/peers/:nodeId - Disconnect peer
federationRouter.delete('/peers/:nodeId', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const removed = await FederationPeerService.removePeer(req.params.nodeId);
    if (removed) {
      res.json({ success: true, message: `Peer node ${req.params.nodeId} disconnected.` });
    } else {
      res.status(404).json({ success: false, error: `Peer node ${req.params.nodeId} not found.` });
    }
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/federation/sync-now - Trigger manual peer discovery & mesh propagation
federationRouter.post('/sync-now', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await FederationPeerService.propagateMeshTopology();
    res.json({ success: true, message: 'Mesh topology propagation completed.', data: result });
  } catch (error) {
    next(error);
  }
});
