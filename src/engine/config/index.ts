import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const baseRootDir = path.resolve(__dirname, '../../..');

const defaultDist = fs.existsSync('/app/dist') ? '/app/dist' : path.join(baseRootDir, 'dist');
const defaultConfig = fs.existsSync('/app/config') ? '/app/config' : path.join(baseRootDir, 'config');
const defaultZtVar = fs.existsSync('/var/lib/zerotier-one') ? '/var/lib/zerotier-one' : path.join(baseRootDir, 'zerotier-var');

// Ensure directories exist
if (!fs.existsSync(defaultDist)) fs.mkdirSync(defaultDist, { recursive: true });
if (!fs.existsSync(defaultConfig)) fs.mkdirSync(defaultConfig, { recursive: true });
if (!fs.existsSync(defaultZtVar)) fs.mkdirSync(defaultZtVar, { recursive: true });

const resolvedConfigPath = process.env.CONFIG_PATH || defaultConfig;

// Refuse the legacy shipped default secret; otherwise require a strong SECRET_KEY.
const INSECURE_DEFAULTS = ['zerotier_planet_secret_key_default_123', ''];
function resolveSecretKey(configPath: string): string {
  const envKey = process.env.SECRET_KEY;
  if (envKey && envKey.trim().length >= 32 && !INSECURE_DEFAULTS.includes(envKey)) {
    return envKey.trim();
  }

  if (envKey && INSECURE_DEFAULTS.includes(envKey)) {
    console.warn('[ZGALAXY SECURITY] SECRET_KEY is set to a known insecure default value. A new key will be generated.');
  } else if (envKey) {
    console.warn('[ZGALAXY SECURITY] SECRET_KEY is shorter than 32 characters. A new key will be generated.');
  }

  // Persist a generated key so it stays stable across restarts
  const secretFile = path.join(configPath, '.secret_key');
  if (fs.existsSync(secretFile)) {
    const existing = fs.readFileSync(secretFile, 'utf-8').trim();
    if (existing && existing.length >= 32) {
      return existing;
    }
  }

  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  console.warn('[ZGALAXY SECURITY] A new SECRET_KEY was generated and persisted at ' + secretFile);
  return generated;
}

const secretKey = resolveSecretKey(resolvedConfigPath);

export const config = {
  port: parseInt(process.env.ENGINE_PORT || '3000', 10),
  secretKey,
  ztPort: parseInt(process.env.ZT_PORT || '9994', 10),
  appPath: process.env.APP_PATH || baseRootDir,
  distPath: process.env.DIST_PATH || defaultDist,
  configPath: resolvedConfigPath,
  ztVarPath: process.env.ZT_VAR_PATH || defaultZtVar,
  idToolPath: process.env.IDTOOL_PATH || path.join(defaultZtVar, 'zerotier-idtool'),
  mkmoonworldPath: process.env.MKMOONWORLD_PATH || path.join(baseRootDir, 'mkmoonworld-x86_64'),
};
