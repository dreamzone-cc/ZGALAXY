import { Router, Request, Response, NextFunction } from 'express';
import { ClusterService } from '../../services/clusterService';
import { requireRole } from '../rbac';

export const clusterRouter = Router();

// GET /api/v1/cluster/status - Retrieve federated cluster topology & health
clusterRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const topology = await ClusterService.getClusterTopology();
    res.json({ success: true, data: topology });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/cluster/nodes/add - Add/Register a Planet node into the cluster
clusterRouter.post('/nodes/add', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nodeId, name, ip4, ip6, domain, port, isLocal, identityPublic } = req.body;
    if (identityPublic !== undefined && typeof identityPublic !== 'string') {
      res.status(400).json({ success: false, error: 'identityPublic must be a string.' });
      return;
    }
    if (!nodeId || !ip4) {
      res.status(400).json({ success: false, error: 'nodeId and ip4 are required fields.' });
      return;
    }

    const topology = await ClusterService.addNode({
      nodeId,
      name: name || `Planet-${nodeId}`,
      ip4,
      ip6: ip6 || '',
      domain: domain || '',
      port: port || 9994,
      // status is probed inside addNode (no caller-supplied ONLINE).
      // ج1: optional operator-supplied public identity (auto-captured from a
      // reachable remote otherwise).
      identityPublic: typeof identityPublic === 'string' ? identityPublic : undefined,
      isLocal: !!isLocal,
    });

    res.status(201).json({ success: true, message: `Node ${nodeId} added to cluster successfully.`, data: topology });
  } catch (error: any) {
    // Validation failures (bad ip/port/nodeId, blocked private IP) are 400.
    res.status(400).json({ success: false, error: error.message || 'Failed to add cluster node.' });
  }
});

// DELETE /api/v1/cluster/nodes/:nodeId - Remove a Planet node from the cluster
clusterRouter.delete('/nodes/:nodeId', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nodeId } = req.params;
    const topology = await ClusterService.removeNode(nodeId);
    res.json({ success: true, message: `Node ${nodeId} removed from cluster.`, data: topology });
  } catch (error: any) {
    if (error && /not found/i.test(error.message)) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
});

// POST /api/v1/cluster/sync - Trigger inter-node synchronization
clusterRouter.post('/sync', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const topology = await ClusterService.syncClusterNodes();
    res.json({ success: true, message: 'Cluster nodes synchronized successfully.', data: topology });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/cluster/build-unified - Compile unified multi-root Planet binary
clusterRouter.post('/build-unified', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ClusterService.buildUnifiedClusterPlanet();
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
