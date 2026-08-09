import { Router } from 'express';
import { NetworkService } from '../../services/networkService';
import { requireRole } from '../rbac';

export const networkRouter = Router();

networkRouter.get('/addresses', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const data = await NetworkService.getNetworkAddresses();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
