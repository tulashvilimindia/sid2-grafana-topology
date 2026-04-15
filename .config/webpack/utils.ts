import fs from 'fs';
import path from 'path';
import { SOURCE_DIR } from './constants';

export function getPluginJson() {
  const pluginJsonPath = path.resolve(SOURCE_DIR, 'plugin.json');
  if (!fs.existsSync(pluginJsonPath)) {
    throw new Error(`plugin.json not found at ${pluginJsonPath}`);
  }
  return JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
}

export function isWSL() {
  try {
    const release = fs.readFileSync('/proc/version', 'utf-8');
    return release.toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

export function getPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
}

export function hasReadme() {
  return fs.existsSync(path.resolve(process.cwd(), 'README.md'));
}

export function getEntries() {
  return {
    module: path.resolve(SOURCE_DIR, 'module.ts'),
  };
}
