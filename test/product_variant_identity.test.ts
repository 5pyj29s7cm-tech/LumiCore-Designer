import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRODUCT_VARIANT } from '../shared/product_variant';

describe('designer product identity', () => {
  it('keeps installer, runtime, and data identities isolated from main Lumi OS', () => {
    const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
    const dataPath = fs.readFileSync('server/config/data_path.ts', 'utf8');
    expect(PRODUCT_VARIANT.runtime.productName).toBe('Lumi Designer');
    expect(PRODUCT_VARIANT.runtime.dataDirectoryName).toBe('LumiOS-Designer');
    expect(tauri).toMatchObject({ productName: 'Lumi Designer', identifier: 'com.lumiai.designer' });
    expect(dataPath).toContain('PRODUCT_VARIANT.runtime.dataDirectoryName');
  });
});
