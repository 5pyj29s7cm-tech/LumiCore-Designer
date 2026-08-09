import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertMCPToolArgumentsAllowed,
  isMCPToolAllowed,
  MCPClientManager,
  type MCPServerConfig,
} from '../server/mcp/client';

describe('managed interior connector policy', () => {
  it('enforces exact tool allowlists and denylists', () => {
    const config: MCPServerConfig = {
      command: 'example',
      enabled: true,
      allowedTools: ['ifc_load', 'ifc_summary'],
      blockedTools: ['ifc_save'],
    };

    expect(isMCPToolAllowed('ifc-readonly', config, 'ifc_load')).toBe(true);
    expect(isMCPToolAllowed('ifc-readonly', config, 'mcp_ifc-readonly_ifc_summary')).toBe(true);
    expect(isMCPToolAllowed('ifc-readonly', config, 'ifc_save')).toBe(false);
    expect(isMCPToolAllowed('ifc-readonly', config, 'ifc_edit')).toBe(false);
  });

  it('blocks network URLs and file paths outside approved roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi_mcp_policy_'));
    const config: MCPServerConfig = {
      command: 'example',
      enabled: true,
      allowedPathRoots: [root],
      allowNetworkUrls: false,
    };
    try {
      expect(() => assertMCPToolArgumentsAllowed('managed', config, {
        file_path: path.join(root, 'project', 'plan.pdf'),
      })).not.toThrow();
      expect(() => assertMCPToolArgumentsAllowed('managed', config, {
        filePath: path.join(path.dirname(root), 'outside.ifc'),
      })).toThrow(/outside its approved project roots/);
      expect(() => assertMCPToolArgumentsAllowed('managed', config, {
        source_url: 'https://example.com/plan.pdf',
      })).toThrow(/blocks URL arguments/);
      expect(() => assertMCPToolArgumentsAllowed('managed', config, {
        source: 'data:text/plain,model',
      })).toThrow(/blocks URL arguments/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('ships disabled PaddleOCR, IFC, and Revit connector templates', () => {
    const config = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'server', 'mcp', 'config.example.json'),
      'utf8',
    ));
    const paddle = config.mcpServers['paddleocr-local'];
    const ifc = config.mcpServers['ifc-readonly'];
    const revit = config.mcpServers['revit-readonly'];

    expect(paddle).toMatchObject({ enabled: false, factoryManaged: true, allowNetworkUrls: false });
    expect(paddle.allowedTools).toEqual(['pp_structurev3']);
    expect(ifc.allowedTools).toContain('ifc_validate');
    expect(ifc.blockedTools).toEqual(expect.arrayContaining(['ifc_save', 'ifc_edit']));
    expect(revit.args).toEqual(expect.arrayContaining(['--read-only', '--disable-toolbaker']));
    expect(revit.allowedTools).toEqual(expect.arrayContaining([
      'revit_get_current_view_info',
      'revit_get_element_details',
      'revit_capture_view_image',
    ]));
    expect(revit.env).toMatchObject({
      BIMWRIGHT_READ_ONLY: '1',
      BIMWRIGHT_ENABLE_TOOLBAKER: '0',
      BIMWRIGHT_ENABLE_ADAPTIVE_BAKE: '0',
    });
    expect(revit.blockedTools).toContain('revit_send_code_to_revit');
  });

  it('adds new managed templates to an existing runtime config without enabling them', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi_mcp_sync_'));
    const configPath = path.join(root, 'mcp.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        legacy: { command: 'legacy', enabled: false },
        'revit-readonly': {
          command: 'unsafe-custom-command',
          args: [],
          env: {},
          enabled: true,
          factoryManaged: true,
        },
      },
      remoteDevices: {},
    }));
    try {
      const manager = new MCPClientManager(configPath, {
        skillsDir: path.join(root, 'skills'),
        quarantineRoot: path.join(root, 'quarantine'),
      });
      const updated = manager.syncFactoryCapabilityMetadata();
      const runtime = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      expect(updated).toEqual(expect.arrayContaining(['paddleocr-local', 'ifc-readonly', 'revit-readonly']));
      expect(runtime.mcpServers.legacy).toMatchObject({ command: 'legacy', enabled: false });
      expect(runtime.mcpServers['paddleocr-local'].enabled).toBe(false);
      expect(runtime.mcpServers['ifc-readonly'].enabled).toBe(false);
      expect(runtime.mcpServers['revit-readonly'].enabled).toBe(true);
      expect(runtime.mcpServers['revit-readonly'].command).toBe('rvt-mcp');
      expect(runtime.mcpServers['revit-readonly'].args).toEqual(['--read-only', '--disable-toolbaker']);
      expect(runtime.mcpServers['revit-readonly'].env).toMatchObject({ BIMWRIGHT_READ_ONLY: '1' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
