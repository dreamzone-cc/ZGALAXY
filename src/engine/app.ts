import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

import { config } from './config';
import { systemRouter } from './routes/system.router';
import { planetRouter } from './routes/planet.router';
import { moonRouter } from './routes/moon.router';
import { identityRouter } from './routes/identity.router';
import { backupRouter } from './routes/backup.router';
import { networkRouter } from './routes/network.router';
import { domainRouter } from './routes/domain.router';
import { ddnsRouter } from './routes/ddns.router';
import { authRouter } from './routes/auth.router';
import { cloudflareRouter } from './routes/cloudflare.router';
import { clusterRouter } from './routes/cluster.router';
import { federationRouter } from './routes/federation.router';
import { UserService } from '../services/userService';

export const app = express();

app.use(cors());
app.use(express.json());

// Public routes that bypass authentication
const isPublicPath = (reqPath: string): boolean => {
  return (
    reqPath === '/api/v1/health' ||
    reqPath === '/api/v1/auth/login' ||
    reqPath === '/api/v1/federation/handshake' ||
    reqPath.startsWith('/api/docs') ||
    reqPath.endsWith('/download')
  );
};

// Bearer Token Auth Middleware (Supports Secret API Key or User Session Tokens)
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (isPublicPath(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Missing or invalid Bearer Token' });
  }

  const token = authHeader.substring(7);

  // Check if token matches Secret Key (SuperAdmin bypass)
  if (token === config.secretKey) {
    (req as any).userRole = 'ADMIN';
    return next();
  }

  // Validate session token against registered users
  const session = await UserService.validateToken(token);
  if (session) {
    (req as any).userRole = session.role;
    (req as any).username = session.username;
    return next();
  }

  return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired session token' });
});

// Swagger Documentation UI
const swaggerDocument = YAML.load(path.join(__dirname, '../../docs/openapi.yaml'));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Route Handlers
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/cloudflare', cloudflareRouter);
app.use('/api/v1', systemRouter);
app.use('/api/v1/planet', planetRouter);
app.use('/api/v1/moons', moonRouter);
app.use('/api/v1/cluster', clusterRouter);
app.use('/api/v1/federation', federationRouter);
app.use('/api/v1/identity', identityRouter);
app.use('/api/v1/backup', backupRouter);
app.use('/api/v1/network', networkRouter);
app.use('/api/v1/domains', domainRouter);
app.use('/api/v1/ddns', ddnsRouter);

// Centralized Error Handling Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[ZGALAXY API ERROR]:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal ZGalaxy Infrastructure Engine Error',
  });
});
