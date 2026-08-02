import { Router, Request, Response, NextFunction } from 'express';
import { FederationTokenService } from '../../services/federationTokenService';
import { FederationPeerService } from '../../services/federationPeerService';

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
federationRouter.get('/tokens', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = await FederationTokenService.listTokens();
    res.json({ success: true, data: tokens });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/federation/tokens/create - Create a new Federation Token
federationRouter.post('/tokens/create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await FederationTokenService.createToken(req.body);
    res.status(201).json({ success: true, message: 'Federation Token created successfully.', data: token });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/federation/tokens/:id/revoke - Permanently revoke token
federationRouter.post('/tokens/:id/revoke', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await FederationTokenService.revokeToken(req.params.id);
    res.json({ success: true, message: `Token ${req.params.id} revoked successfully.`, data: token });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/federation/tokens/:id/renew - Extend token expiration date
federationRouter.post('/tokens/:id/renew', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { extensionDays } = req.body;
    const token = await FederationTokenService.renewToken(req.params.id, extensionDays ? Number(extensionDays) : 30);
    res.json({ success: true, message: `Token ${req.params.id} renewed.`, data: token });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/federation/join - Join remote ZGALAXY node using Token
federationRouter.post('/join', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { targetEndpoint, tokenSecret, syncMode } = req.body;
    const result = await FederationPeerService.joinFederation(targetEndpoint, tokenSecret, syncMode);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
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
federationRouter.delete('/peers/:nodeId', async (req: Request, res: Response, next: NextFunction) => {
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
federationRouter.post('/sync-now', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await FederationPeerService.propagateMeshTopology();
    res.json({ success: true, message: 'Mesh topology propagation completed.', data: result });
  } catch (error) {
    next(error);
  }
});
