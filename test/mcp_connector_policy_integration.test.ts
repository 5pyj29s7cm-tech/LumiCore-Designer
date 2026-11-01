import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ connect: vi.fn(), list: vi.fn(), call: vi.fn(), close: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = fake.connect;
    listTools = fake.list;
    callTool = fake.call;
  },
}));
vi.mock('../server/mcp/client/transport', () => ({ createMCPTransport: () => ({ close: fake.close }) }));
import { assertMCPToolArgumentsAllowed, isMCPToolAllowed, MCPClientManager, mcpServerConfigFingerprint, type MCPServerConfig } from '../server/mcp/client';
import { hasCurrentCachedToolInventory } from '../server/mcp/client/fingerprints';
import { MANAGED_CONNECTOR_TEMPLATES } from '../server/mcp/client/connector_templates';
import { reconcileMCPConnectorPolicy } from '../server/mcp/client/connector_policy';

const roots: string[] = [];
const managers: MCPClientManager[] = [];
function temp() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-connector-policy-')); roots.push(root); return root; }
function manager(config: MCPServerConfig) {
  const root = temp();
  const configPath = path.join(root, 'mcp.json');
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { managed: config } }));
  const instance = new MCPClientManager(configPath, { skillsDir: path.join(root, 'skills'), quarantineRoot: path.join(root, 'quarantine') });
  managers.push(instance);
  return instance;
}
function config(extra: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return { enabled: true, source: 'external', transport: 'stdio', command: 'fixture-runtime', allowedTools: ['read'], blockedTools: ['write'], ...extra };
}
const declarations = ['read', 'write', 'unlisted'].map(name => ({ name, inputSchema: { type: 'object' } }));
beforeEach(() => {
  vi.clearAllMocks();
  fake.connect.mockResolvedValue(undefined); fake.list.mockResolvedValue({ tools: declarations });
  fake.call.mockResolvedValue({ content: [{ type: 'text', text: 'fixture result' }] }); fake.close.mockResolvedValue(undefined);
});
afterEach(async () => {
  for (const instance of managers.splice(0)) await instance.disconnectAll();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('designer connector restrictions in the modular MCP runtime', () => {
  it('denies blocked tools even if allowlisted, without case or owner-prefix broadening', () => {
    const policy = config({ allowedTools: ['read', 'write'] });
    expect(isMCPToolAllowed('managed', policy, 'write')).toBe(false);
    expect(isMCPToolAllowed('managed', policy, 'READ')).toBe(false);
    expect(isMCPToolAllowed('managed', policy, 'mcp_other_read')).toBe(false);
    expect(isMCPToolAllowed('managed', policy, 'mcp_managed_read')).toBe(true);
  });

  it('rejects a denied call before connecting, including the full registry-name entry point', async () => {
    const instance = manager(config());
    await expect(instance.callToolForServer('managed', 'write', {})).rejects.toThrow(/blocks tool/);
    await expect(instance.callTool('mcp_managed_unlisted', {})).rejects.toThrow(/blocks tool/);
    expect(fake.connect).not.toHaveBeenCalled(); expect(fake.call).not.toHaveBeenCalled();
  });

  it('checks nested file and URL arguments before any transport starts', async () => {
    const approved = temp();
    const instance = manager(config({ allowedPathRoots: [approved], allowNetworkUrls: false }));
    await expect(instance.callToolForServer('managed', 'read', { batch: [{ filePath: path.join(approved, '..', 'escape.ifc') }] })).rejects.toThrow(/approved project roots/);
    await expect(instance.callToolForServer('managed', 'read', { sources: ['https://example.invalid/model.ifc'] })).rejects.toThrow(/blocks URL/);
    expect(fake.connect).not.toHaveBeenCalled(); expect(fake.call).not.toHaveBeenCalled();
  });

  it('does not reinterpret a protocol name that resembles a full registry name as the allowed raw tool', async () => {
    const instance = manager(config());
    await expect(instance.callToolForServer('managed', 'mcp_managed_read', {})).rejects.toThrow(/blocks tool/);
    fake.list.mockResolvedValue({ tools: [...declarations, { name: 'mcp_managed_read', inputSchema: {} }] });
    expect((await (instance as any).connectServer('managed', config())).map((tool: any) => tool.rawName)).toEqual(['read']);
    expect(fake.call).not.toHaveBeenCalled();
  });

  it('filters fresh and already-connected tool inventories, while allowing the exact read call', async () => {
    const approved = temp(); const settings = config({ allowedPathRoots: [approved], allowNetworkUrls: false });
    const instance = manager(settings);
    const tools = await (instance as any).connectServer('managed', settings);
    expect(tools.map((tool: any) => tool.rawName)).toEqual(['read']);
    expect((await (instance as any).connectServer('managed', settings)).map((tool: any) => tool.rawName)).toEqual(['read']);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(await instance.callToolForServer('managed', 'read', { file_path: path.join(approved, 'plan.ifc') })).toBe('fixture result');
    expect(fake.call).toHaveBeenCalledWith({ name: 'read', arguments: { file_path: path.join(approved, 'plan.ifc') } });
  });

  it('filters a current cached inventory without connecting or exposing blocked tools', async () => {
    const settings = config();
    settings.cachedTools = declarations.map(tool => ({ ...tool, serverName: 'managed', rawName: tool.name, name: `mcp_managed_${tool.name}` }));
    settings.cachedToolsFingerprint = mcpServerConfigFingerprint(settings);
    const tools = await manager(settings).connectAll();
    expect(tools.map(tool => tool.rawName)).toEqual(['read']); expect(fake.connect).not.toHaveBeenCalled();
  });

  it('policy changes invalidate cached declarations and block previously allowed live calls', async () => {
    const settings = config({ allowedTools: ['read', 'unlisted'] });
    settings.cachedTools = [{ serverName: 'managed', rawName: 'unlisted', name: 'mcp_managed_unlisted', inputSchema: {} }];
    settings.cachedToolsFingerprint = mcpServerConfigFingerprint(settings);
    expect(hasCurrentCachedToolInventory(settings)).toBe(true);
    const instance = manager(settings);
    await (instance as any).connectServer('managed', settings);
    const narrowed = { ...settings, allowedTools: ['read'] };
    expect(hasCurrentCachedToolInventory(narrowed)).toBe(false);
    instance.saveConfig({ managed: narrowed });
    await expect(instance.callToolForServer('managed', 'unlisted', {})).rejects.toThrow(/blocks tool/);
    expect(fake.call).not.toHaveBeenCalled();
  });

  it('does not let connector policy bypass the managed local runtime identity gate', async () => {
    const instance = manager(config({ source: 'local' }));
    vi.spyOn(instance, 'assertLocalSkillRuntimeIdentity').mockImplementation(() => { throw new Error('fixture identity mismatch'); });
    await expect(instance.callToolForServer('managed', 'read', {})).rejects.toThrow(/identity mismatch/);
    expect(fake.connect).not.toHaveBeenCalled(); expect(fake.call).not.toHaveBeenCalled();
  });

  it('rejects an options configuration that attempts to relax the stored policy', async () => {
    const instance = manager(config());
    await expect(instance.callToolForServer('managed', 'write', {}, { configuration: config({ allowedTools: [], blockedTools: [] }) })).rejects.toThrow(/different managed configuration/);
    expect(fake.call).not.toHaveBeenCalled();
  });

  it('resolves junction ancestors before accepting a not-yet-created descendant', () => {
    const fixture = temp(); const approved = path.join(fixture, 'approved'); const outside = path.join(fixture, 'outside');
    fs.mkdirSync(approved); fs.mkdirSync(outside);
    const link = path.join(approved, 'linked'); fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const settings = config({ allowedPathRoots: [approved] });
    expect(() => assertMCPToolArgumentsAllowed('managed', settings, { file_path: path.join(link, 'new', 'plan.ifc') })).toThrow(/approved project roots/);
    expect(() => assertMCPToolArgumentsAllowed('managed', settings, { file_path: path.join(approved, 'new', 'plan.ifc') })).not.toThrow();
  });

  it('keeps data URLs and file URLs blocked under the no-URL connector policy', () => {
    for (const value of ['data:text/plain,fixture', 'file:///C:/outside.ifc', 'https://example.invalid/source']) {
      expect(() => assertMCPToolArgumentsAllowed('managed', config({ allowNetworkUrls: false }), { nested: { source: value } })).toThrow(/blocks URL/);
    }
  });

  it('rejects a broken junction instead of treating its missing descendants as normal new paths', () => {
    const fixture = temp(); const approved = path.join(fixture, 'approved'); fs.mkdirSync(approved);
    fs.symlinkSync(path.join(fixture, 'missing-target'), path.join(approved, 'broken'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => assertMCPToolArgumentsAllowed('managed', config({ allowedPathRoots: [approved] }), {
      file_path: path.join(approved, 'broken', 'new.ifc'),
    })).toThrow(/cannot verify/);
  });

  it('fails closed when canonical path resolution cannot be verified', () => {
    const approved = temp();
    vi.spyOn(fs.realpathSync, 'native').mockImplementation(() => { throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' }); });
    expect(() => assertMCPToolArgumentsAllowed('managed', config({ allowedPathRoots: [approved] }), {
      file_path: path.join(approved, 'new.ifc'),
    })).toThrow(/cannot verify/);
  });

  it('keeps all offline fallback templates identical to the disabled factory definitions', () => {
    const factory = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server/mcp/config.example.json'), 'utf8'));
    for (const [name, settings] of Object.entries(MANAGED_CONNECTOR_TEMPLATES)) {
      expect(settings).toEqual(factory.mcpServers[name]); expect(settings.enabled).toBe(false);
    }
  });

  it('leaves non-factory policy and factory enablement under their existing owners', () => {
    const unmanaged = config({ allowedTools: ['custom'] });
    expect(reconcileMCPConnectorPolicy(unmanaged, config())).toBe(false);
    expect(unmanaged.allowedTools).toEqual(['custom']);
    const managed = config({ enabled: true });
    expect(reconcileMCPConnectorPolicy(managed, MANAGED_CONNECTOR_TEMPLATES['revit-readonly'])).toBe(true);
    expect(managed.enabled).toBe(true); expect(managed.args).toEqual(['--read-only', '--disable-toolbaker']);
    expect(reconcileMCPConnectorPolicy(managed, MANAGED_CONNECTOR_TEMPLATES['revit-readonly'])).toBe(false);
  });
});
