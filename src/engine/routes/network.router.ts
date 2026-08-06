import { Router } from 'express';
import { NetworkService } from '../../services/networkService';

export const networkRouter = Router();

networkRouter.get('/addresses', async (req, res, next) => {
  try {
    const data = await NetworkService.getNetworkAddresses();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
