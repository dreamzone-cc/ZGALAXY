import { Router } from 'express';
import { IdentityService } from '../../services/identityService';

export const identityRouter = Router();

identityRouter.get('/status', async (req, res, next) => {
  try {
    const status = await IdentityService.getIdentityStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

identityRouter.post('/generate', async (req, res, next) => {
  try {
    const result = await IdentityService.generateIdentity();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

identityRouter.post('/rotate', async (req, res, next) => {
  try {
    const result = await IdentityService.rotateCertificates();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

identityRouter.post('/verify', async (req, res, next) => {
  try {
    const result = await IdentityService.verifyIdentity();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
