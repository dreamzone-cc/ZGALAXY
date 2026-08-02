import path from 'path';
import fs from 'fs';
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

export const config = {
  port: parseInt(process.env.ENGINE_PORT || '3000', 10),
  secretKey: process.env.SECRET_KEY || 'zerotier_planet_secret_key_default_123',
  ztPort: parseInt(process.env.ZT_PORT || '9994', 10),
  appPath: process.env.APP_PATH || baseRootDir,
  distPath: process.env.DIST_PATH || defaultDist,
  configPath: process.env.CONFIG_PATH || defaultConfig,
  ztVarPath: process.env.ZT_VAR_PATH || defaultZtVar,
  idToolPath: process.env.IDTOOL_PATH || path.join(defaultZtVar, 'zerotier-idtool'),
  mkmoonworldPath: process.env.MKMOONWORLD_PATH || path.join(baseRootDir, 'mkmoonworld-x86_64'),
};
