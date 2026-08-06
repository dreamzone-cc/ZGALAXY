import { Router } from 'express';
import { BackupService } from '../../services/backupService';
import { requireRole } from '../rbac';

export const backupRouter = Router();

backupRouter.post('/export', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const result = await BackupService.exportBackup();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

backupRouter.post('/import', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { tarPath } = req.body;
    const result = await BackupService.importBackup(tarPath);
    res.json(result);
  } catch (err: any) {
    // Client-supplied archive validation failures are 400, not 500.
    res.status(400).json({ success: false, error: err.message || 'Backup import failed.' });
  }
});
