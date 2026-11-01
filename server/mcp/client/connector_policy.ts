import fs from 'node:fs';
import path from 'node:path';
import { getDataRoot } from '../../config/data_path';
import { expandPortablePath } from './package_paths';
import type { MCPServerConfig } from './contracts';

// Connector argument restrictions supplement, never replace, managed runtime identity.
function expandPolicyPath(value: string): string {
  return expandPortablePath(String(value || ''))
    .replace(/\$\{LUMI_DATA_ROOT\}/g, getDataRoot())
    .replace(/\$\{LUMI_DATA_DIR\}/g, path.join(getDataRoot(), 'data'));
}

function shortConfiguredToolName(serverName: string, toolName: string): string {
  const prefix = `mcp_${serverName}_`;
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
}

export function isMCPToolAllowed(
  serverName: string,
  config: MCPServerConfig,
  toolName: string,
): boolean {
  return isMCPRawToolAllowed(config, shortConfiguredToolName(serverName, toolName));
}

/** Protocol names are exact: a raw name that resembles a registry prefix is not an alias. */
export function isMCPRawToolAllowed(config: MCPServerConfig, shortName: string): boolean {
  const blocked = new Set((config.blockedTools || []).map(item => String(item).trim()).filter(Boolean));
  if (blocked.has(shortName)) return false;
  const allowed = (config.allowedTools || []).map(item => String(item).trim()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(shortName);
}

function isWithinRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalPolicyPath(value: string): string {
  const resolved = path.resolve(value);
  let existing = resolved;
  const missingSegments: string[] = [];
  for (;;) {
    try {
      // lstat sees a broken link; existsSync would misclassify it as a new path.
      fs.lstatSync(existing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('MCP connector cannot verify the configured path boundary');
      }
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error('MCP connector cannot verify the configured path boundary');
      missingSegments.unshift(path.basename(existing));
      existing = parent;
      continue;
    }
    try {
      return path.resolve(fs.realpathSync.native(existing), ...missingSegments);
    } catch {
      throw new Error('MCP connector cannot verify the configured path boundary');
    }
  }
}

function isPathArgumentKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return /(^|_)(path|paths|file|files|filepath|filename|directory|directories|folder|folders|root|roots)($|_)/i.test(normalized);
}

export function assertMCPToolArgumentsAllowed(
  serverName: string,
  config: MCPServerConfig,
  args: Record<string, any>,
): void {
  const roots = (config.allowedPathRoots || [])
    .map(expandPolicyPath)
    .filter(Boolean)
    .map(canonicalPolicyPath);

  const inspect = (value: unknown, key: string): void => {
    if (Array.isArray(value)) {
      value.forEach(item => inspect(item, key));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        inspect(nestedValue, nestedKey);
      }
      return;
    }
    if (typeof value !== 'string' || !value.trim()) return;
    const text = value.trim();
    const isWindowsPath = /^[a-z]:[\\/]/i.test(text);
    if (!isWindowsPath && /^[a-z][a-z0-9+.-]*:/i.test(text)) {
      if (config.allowNetworkUrls === false) {
        throw new Error(`MCP server "${serverName}" blocks URL arguments for this managed connector`);
      }
      return;
    }
    if (!isPathArgumentKey(key) || roots.length === 0) return;
    const target = canonicalPolicyPath(expandPolicyPath(text));
    if (!roots.some(root => isWithinRoot(target, root))) {
      throw new Error(`MCP server "${serverName}" blocks paths outside its approved project roots`);
    }
  };

  for (const [key, value] of Object.entries(args || {})) inspect(value, key);
}

/** Keep factory connector safety settings current without enabling any connector. */
export function reconcileMCPConnectorPolicy(server: MCPServerConfig, factory: MCPServerConfig): boolean {
  if (factory.factoryManaged !== true) return false;
  const fields = ['factoryManaged', 'setupUrl', 'setupHint', 'allowedTools', 'blockedTools',
    'allowedPathRoots', 'allowNetworkUrls', 'command', 'args', 'env', 'source', 'transport'] as const;
  let changed = false;
  for (const field of fields) {
    if (JSON.stringify(server[field]) === JSON.stringify(factory[field])) continue;
    if (factory[field] === undefined) delete server[field];
    else (server as unknown as Record<string, unknown>)[field] = JSON.parse(JSON.stringify(factory[field]));
    changed = true;
  }
  return changed;
}
