import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRODUCT_VARIANT } from '../shared/product_variant';

describe('designer product identity', () => {
  it('keeps the Designer installer identity while sharing the canonical backend data root', () => {
    const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
      productName: string;
      identifier: string;
      plugins: { updater: { endpoints: string[] } };
    };
    const dataPath = fs.readFileSync('server/config/data_path.ts', 'utf8');
    const localWhisper = fs.readFileSync('server/stt/providers/local-whisper.ts', 'utf8');
    const nativeBootstrap = fs.readFileSync('src-tauri/src/local_bootstrap.rs', 'utf8');
    const serverEntry = fs.readFileSync('server.ts', 'utf8');
    expect(PRODUCT_VARIANT.runtime.productName).toBe('Lumi Designer');
    expect(PRODUCT_VARIANT.runtime.dataDirectoryName).toBe('LumiCore');
    expect(PRODUCT_VARIANT.runtime.legacyDataDirectoryName).toBe('LumiOS');
    expect(tauri).toMatchObject({
      productName: PRODUCT_VARIANT.runtime.productName,
      identifier: PRODUCT_VARIANT.runtime.appIdentifier,
    });
    expect(tauri.plugins.updater.endpoints).toEqual([
      expect.stringContaining(`/${PRODUCT_VARIANT.runtime.updaterChannel}/`),
    ]);
    expect(dataPath).toContain('PRODUCT_VARIANT.runtime.dataDirectoryName');
    expect(dataPath).toContain('PRODUCT_VARIANT.runtime.legacyDataDirectoryName');
    expect(localWhisper).toContain('PRODUCT_VARIANT.runtime.legacyDataDirectoryName');
    expect(localWhisper).not.toContain("path.join(os.homedir(), 'LumiOS'");
    expect(nativeBootstrap).toContain(`PRODUCT_DATA_DIRECTORY: &str = "${PRODUCT_VARIANT.runtime.dataDirectoryName}"`);
    expect(serverEntry).toContain('PRODUCT_VARIANT.runtime.dataDirectoryName');
  });
});
