import { Router } from 'express';
import { DomainService } from '../../services/domainService';

export const domainRouter = Router();

domainRouter.get('/', async (req, res, next) => {
  try {
    const domains = await DomainService.getDomains();
    res.json({ success: true, data: domains });
  } catch (err) {
    next(err);
  }
});

domainRouter.post('/verify', async (req, res, next) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ success: false, error: 'Domain name is required' });
    }
    const result = await DomainService.verifyDomain(domain);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

domainRouter.post('/bind', async (req, res, next) => {
  try {
    const { domain, target } = req.body;
    if (!domain) {
      return res.status(400).json({ success: false, error: 'Domain name is required' });
    }
    const result = await DomainService.bindDomain(domain, target || 'PLANET');
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
