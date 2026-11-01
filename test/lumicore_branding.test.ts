import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCT_VARIANT } from '../shared/product_variant';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('LumiCore engine and product-variant identity', () => {
  it('uses the LumiCore engine names and the configured product-facing names', () => {
    const packageJson = JSON.parse(read('package.json')) as { name: string };
    const tauri = JSON.parse(read('src-tauri/tauri.conf.json')) as {
      productName: string;
      identifier: string;
      app: { windows: Array<{ title: string }> };
    };
    const cargo = read('src-tauri/Cargo.toml');

    expect(packageJson.name).toBe('lumi-core');
    expect(cargo).toContain('name = "lumi-core"');
    expect(cargo).toContain('name = "lumi_core_lib"');
    expect(read('src-tauri/src/main.rs')).toContain('lumi_core_lib::run()');
    expect(tauri.productName).toBe(PRODUCT_VARIANT.runtime.productName);
    expect(tauri.app.windows[0]?.title).toBe(PRODUCT_VARIANT.runtime.desktopTitle);
    expect(fs.existsSync(path.join(root, 'assets', 'lumiCore-icon.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'assets', 'lumiOS-icon.svg'))).toBe(false);
    expect(read('scripts/smoke-windows-installer.ps1')).toContain('$($TauriConfig.productName)_$($PackageJson.version)_x64-setup.exe');
    expect(read('scripts/smoke-windows-installer.ps1')).toContain('lumi-core.exe');
  });

  it('keeps the stable app identity and engine-level process fallbacks', () => {
    const tauri = JSON.parse(read('src-tauri/tauri.conf.json')) as {
      identifier: string;
      plugins: { updater: { endpoints: string[] } };
    };
    const desktopPlan = read('server/desktop/execution_plan.ts');
    const devPreparation = read('scripts/prepare-tauri-dev.mjs');

    expect(tauri.identifier).toBe(PRODUCT_VARIANT.runtime.appIdentifier);
    expect(tauri.plugins.updater.endpoints).toEqual([
      expect.stringContaining(`/${PRODUCT_VARIANT.runtime.updaterChannel}/`),
    ]);
    expect(tauri.plugins.updater.endpoints[0]).not.toContain('/lumi-core/');
    expect(tauri.plugins.updater.endpoints[0]).not.toContain('/lumi-os/');
    expect(desktopPlan).toContain("processPatterns: ['lumi', 'lumi-core', 'lumi-os']");
    expect(devPreparation).toContain("['lumi-core.exe', 'lumi-os.exe']");
  });

  it('uses a repository-relative NSIS source and targets the configured variant repository', () => {
    const nsis = read('src-tauri/includes/include-dll.nsh');
    const ci = read('.github/workflows/ci.yml');
    const installers = read('.github/workflows/build-installers.yml');
    const variant = JSON.parse(read('.lumi/variant.json')) as { repository: string };
    const repositorySlug = new URL(variant.repository).pathname
      .replace(/^\//, '')
      .replace(/\.git$/, '');

    expect(nsis).toContain('!define LUMI_INSTALLER_HOOK_DIR "${__FILEDIR__}"');
    expect(nsis).toContain('${LUMI_INSTALLER_HOOK_DIR}\\..\\..\\desktop-resources\\WebView2Loader.dll');
    expect(nsis).not.toMatch(/[A-Z]:\\/i);
    expect(nsis).toContain('stable installer identity');
    expect(nsis).not.toContain('LUMI_LEGACY_UNINSTKEY');
    expect(nsis).not.toContain('ExecWait');
    expect(nsis).not.toContain('DeleteRegKey');
    for (const workflow of [ci, installers]) {
      expect(workflow).toContain(repositorySlug);
      expect(workflow).not.toContain('5pyj29s7cm-tech/LumiCore');
      expect(workflow).not.toContain('5pyj29s7cm-tech/LumiOS');
      expect(workflow).not.toMatch(/uses:\s+[^\s]+@(v\d+|stable)\b/);
    }
  });
});
