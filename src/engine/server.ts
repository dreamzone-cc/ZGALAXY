import { app } from './app';
import { config } from './config';
import { DDNSService } from '../services/ddnsService';
import { CloudflareService } from '../services/dns/cloudflareService';

app.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`ZGalaxy Planet/Moon Infrastructure Engine Running!`);
  console.log(`Port: ${config.port}`);
  console.log(`Interactive API Specs: http://localhost:${config.port}/api/docs`);
  console.log(`=======================================================`);

  // Start periodic Dynamic IP (DDNS) auto-sync worker
  setInterval(async () => {
    try {
      const syncResult = await DDNSService.checkAndSyncDDNS();
      if (syncResult.changed) {
        console.log(`[ZGALAXY DDNS WORKER] ${syncResult.message}`);
      }
    } catch (err: any) {
      console.error(`[ZGALAXY DDNS ERROR] ${err.message}`);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

  // Start periodic Cloudflare DNS auto-sync worker
  setInterval(async () => {
    try {
      const cfResult = await CloudflareService.syncDNS(false);
      if (cfResult.synced) {
        console.log(`[ZGALAXY CLOUDFLARE WORKER] ${cfResult.message}`);
      }
    } catch (err: any) {
      console.error(`[ZGALAXY CLOUDFLARE ERROR] ${err.message}`);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
});
