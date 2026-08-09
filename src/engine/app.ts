import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { rateLimit } from 'express-rate-limit';

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

app.disable('x-powered-by');

// Trust one hop behind a reverse proxy ONLY when explicitly configured
// (TRUST_PROXY=1). Without a real reverse proxy in front, trusting
// X-Forwarded-For would let direct clients spoof their IP and bypass the
// rate limiters.
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// CORS: allow only known origins (configurable via CORS_ORIGINS, comma-separated).
// If not configured, default to the standard web-console origins so a fresh
// production deploy works out of the box; an explicit CORS_ORIGINS always wins.
const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0);
const allowedOrigins = configuredOrigins.length > 0
  ? configuredOrigins
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin (no Origin header) and any explicitly allowed origin.
      // Disallowed origins fail closed silently (no ACAO header), never a 500.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  })
);

// Security headers on all responses.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0'); // XSS filter deprecated; replaced by CSP below
  // Login/session responses must not be cached by shared caches.
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// JSON body parsing with an explicit, documented limit.
app.use(express.json({ limit: '100kb' }));

// Baseline global rate limiter; stricter per-route tiers are layered on top.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' },
});
app.use('/api/', globalLimiter);

// Rate limiting for high-risk endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Please try again later.' },
});

const handshakeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many federation handshake attempts.' },
});

const joinLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many federation join attempts.' },
});

app.use('/api/v1/auth/login', loginLimiter);
app.use('/api/v1/federation/handshake', handshakeLimiter);
app.use('/api/v1/federation/join', joinLimiter);

// Constant-time comparison for the super-admin secret.
// Both values are hashed to a fixed length first so the comparison does not
// leak the secret's length through an early return (L1).
function secretsEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Public routes that bypass authentication
const isPublicPath = (reqPath: string): boolean => {
  const normalized = reqPath.replace(/\/+$/, '') || '/';
  return (
    normalized === '/api/v1/health' ||
    normalized === '/api/v1/ready' ||
    normalized === '/api/v1/metrics' ||
    normalized === '/api/v1/auth/login' ||
    normalized === '/api/v1/federation/handshake' ||
    normalized === '/api/v1/planet/download' ||
    // Moon files are world artifacts (like the planet) and are fetched by
    // clients via plain links, so the download endpoint is public.
    (normalized.startsWith('/api/v1/moons/') && normalized.endsWith('/download')) ||
    normalized.startsWith('/api/docs')
  );
};

// Bearer Token Auth Middleware (Supports Secret API Key or User Session Tokens)
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (isPublicPath(req.path)) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Missing or invalid Bearer Token' });
    }

    const token = authHeader.substring(7);

    // Check if token matches Secret Key (SuperAdmin bypass)
    if (secretsEqual(token, config.secretKey)) {
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
  } catch (err) {
    // Never let a store/db failure hang the request or crash the process.
    next(err);
  }
});

// Swagger Documentation UI (lazy-loaded so a missing spec never kills boot)
let swaggerDocument: any = null;
try {
  swaggerDocument = YAML.load(path.join(__dirname, '../../docs/openapi.yaml'));
} catch (err: any) {
  console.warn('[ZGALAXY] Failed to load openapi.yaml; /api/docs disabled:', err.message);
}
if (swaggerDocument) {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

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

// JSON 404 handler so unknown API paths match the {success,error} contract.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Centralized Error Handling Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || err.statusCode || (err.type === 'entity.parse.failed' ? 400 : 500);
  console.error(`[ZGALAXY API ERROR] ${req.method} ${req.path}:`, err);
  // Never leak internal details (paths, CLI stderr, SQLite messages) to clients.
  res.status(status).json({
    success: false,
    error: status >= 500 ? 'Internal ZGalaxy Infrastructure Engine Error' : err.message || 'Request failed',
  });
});
