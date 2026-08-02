import { Router } from 'express';
import { BackupService } from '../../services/backupService';

export const backupRouter = Router();

backupRouter.post('/export', async (req, res, next) => {
  try {
    const result = await BackupService.exportBackup();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

backupRouter.post('/import', async (req, res, next) => {
  try {
    const { tarPath } = req.body;
    const result = await BackupService.importBackup(tarPath);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
