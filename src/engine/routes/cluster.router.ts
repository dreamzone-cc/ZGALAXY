import { Router, Request, Response, NextFunction } from 'express';
import { ClusterService } from '../../services/clusterService';

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
clusterRouter.post('/nodes/add', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nodeId, name, ip4, ip6, domain, port, isLocal } = req.body;
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
      status: 'ONLINE',
      isLocal: !!isLocal,
    });

    res.json({ success: true, message: `Node ${nodeId} added to cluster successfully.`, data: topology });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/cluster/nodes/:nodeId - Remove a Planet node from the cluster
clusterRouter.delete('/nodes/:nodeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nodeId } = req.params;
    const topology = await ClusterService.removeNode(nodeId);
    res.json({ success: true, message: `Node ${nodeId} removed from cluster.`, data: topology });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/cluster/sync - Trigger inter-node synchronization
clusterRouter.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const topology = await ClusterService.syncClusterNodes();
    res.json({ success: true, message: 'Cluster nodes synchronized successfully.', data: topology });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/cluster/build-unified - Compile unified multi-root Planet binary
clusterRouter.post('/build-unified', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ClusterService.buildUnifiedClusterPlanet();
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
