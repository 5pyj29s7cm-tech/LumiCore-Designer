import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PRODUCT_VARIANT } from '../shared/product_variant';
import { getDataRoot, hasExplicitDataRoot, resolveDefaultDataRoot, migrateLegacyProductDataRoot, preflightProductDataMigrationReceipts, markLegacyProductDataMigrationVerified, resolveMigratedDataFile } from '../server/config/data_path';

// Only synthetic files. A nonempty .db marker is metadata input, not a real
// SQLite store or a claim that an actual database integrity check was performed.
let home: string;
const originalDataRoot = process.env.LUMI_DATA_DIR;
const digest = (input: string) => crypto.createHash('sha256').update(input).digest('hex');
const rootDigest = (input: string) => digest(process.platform === 'win32' ? path.resolve(input).toLowerCase() : path.resolve(input));
const write = (file: string, value: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, { mode: 0o600 }); };
function receipts(currentName = 'LumiCore', legacyName = 'LumiOS', product = 'LumiCore', verified = true) {
  const current = path.join(home, currentName), legacy = path.join(home, legacyName);
  write(path.join(current, 'data/lumi.db'), 'SYNTHETIC DATABASE METADATA ONLY');
  write(path.join(current, 'data/knowledge/original.txt'), 'Original full fixture body retained');
  const prepared = { version: 1, product, migrationId: 'a'.repeat(43), phase: 'prepared', method: 'atomic_directory_rename', migratedFrom: legacy, migratedTo: current,
    sourceRootDigest: rootDigest(legacy), targetRootDigest: rootDigest(current), preparedAt: '2026-11-02T00:00:00Z' };
  const raw = JSON.stringify(prepared) + '\n';
  write(path.join(current, 'runtime/product-data-migration.json'), raw);
  const verification = { version: 1, product, migrationReceipt: 'product-data-migration.json', migrationId: prepared.migrationId,
    migrationReceiptSha256: digest(raw), quickCheck: 'ok', databaseBytes: fs.statSync(path.join(current, 'data/lumi.db')).size,
    userCount: 1, conversationCount: 2, interactionCount: 3, verifiedAt: '2026-11-02T00:01:00Z' };
  if (verified) write(path.join(current, 'runtime/product-data-migration-verified.json'), JSON.stringify(verification));
  return { current, legacy, prepared, verification };
}
function tree(directory: string): Array<[string, string]> {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? tree(file).map(([relative, hash]): [string, string] => [path.join(entry.name, relative), hash]) : [[entry.name, digest(fs.readFileSync(file, 'utf8'))] as [string, string]];
  }).sort(([a], [b]) => a.localeCompare(b));
}
beforeEach(() => { home = fs.mkdtempSync(path.join(String(process.env.LUMI_TEST_TMPDIR || os.tmpdir()), 'designer-shared-root-')); });
afterEach(() => {
  if (originalDataRoot === undefined) delete process.env.LUMI_DATA_DIR; else process.env.LUMI_DATA_DIR = originalDataRoot;
  vi.restoreAllMocks();
  const base = path.resolve(String(process.env.LUMI_TEST_TMPDIR || os.tmpdir()));
  if (path.dirname(home) !== base || !path.basename(home).startsWith('designer-shared-root-')) throw Error('Unsafe synthetic root cleanup');
  fs.rmSync(home, { recursive: true, force: true });
});

it('shares the Main default and legacy rename identity while retaining the Designer installer identity', () => {
  expect(PRODUCT_VARIANT.runtime.dataDirectoryName).toBe('LumiCore');
  expect(PRODUCT_VARIANT.runtime.legacyDataDirectoryName).toBe('LumiOS');
  expect(PRODUCT_VARIANT.runtime.productName).toBe('Lumi Designer');
  expect(PRODUCT_VARIANT.runtime.appIdentifier).toBe('com.lumiai.designer');
  expect(resolveDefaultDataRoot(home)).toBe(path.join(home, 'LumiCore'));
  const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  expect(tauri.identifier).toBe('com.lumiai.designer'); expect(tauri.productName).toBe('Lumi Designer');
  expect(tauri.plugins.updater.endpoints).toEqual([expect.stringContaining(`/${PRODUCT_VARIANT.runtime.updaterChannel}/`)]);
});

it('keeps native bootstrap on the same shared default without renaming the Designer autostart entry', () => {
  const native = fs.readFileSync('src-tauri/src/local_bootstrap.rs', 'utf8');
  expect(native).toContain('PRODUCT_DATA_DIRECTORY: &str = "LumiCore"');
  expect(native).toContain('std::env::var("LUMI_DATA_DIR")');
  expect(native).toContain('configured_data_root(&configured)?');
  expect(fs.readFileSync('src-tauri/src/lib.rs', 'utf8')).toContain('AUTOSTART_VALUE_NAME: &str = "LumiCore-Designer"');
});

it.each([false, true])('does not move, merge or write either old Designer directory when shared data already exists=%s', sharedExists => {
  for (const name of ['LumiCore-Designer', 'LumiOS-Designer']) write(path.join(home, name, 'data/original.txt'), `Original ${name} record`);
  if (sharedExists) write(path.join(home, 'LumiCore/data/shared.txt'), 'Existing Main data');
  const before = tree(home), claim = vi.fn(() => ({ releaseAt: () => true }));
  expect(migrateLegacyProductDataRoot(claim, home)).toBe(path.join(home, 'LumiCore'));
  expect(claim).not.toHaveBeenCalled(); expect(tree(home)).toEqual(before);
  if (!sharedExists) expect(fs.existsSync(path.join(home, 'LumiCore'))).toBe(false);
});

it('accepts an existing Main prepared receipt and writes only a matching Main verification receipt', () => {
  const f = receipts('LumiCore', 'LumiOS', 'LumiCore', false);
  const before = fs.readFileSync(path.join(f.current, 'runtime/product-data-migration.json'), 'utf8');
  expect(preflightProductDataMigrationReceipts(f.current)).toBe(true);
  expect(markLegacyProductDataMigrationVerified({ quickCheck: 'ok', userCount: 1, conversationCount: 2, interactionCount: 3 }, f.current)).toBe(true);
  const verified = JSON.parse(fs.readFileSync(path.join(f.current, 'runtime/product-data-migration-verified.json'), 'utf8'));
  expect(verified).toMatchObject({ product: 'LumiCore', migrationReceiptSha256: digest(before), userCount: 1, conversationCount: 2, interactionCount: 3 });
  expect(fs.readFileSync(path.join(f.current, 'runtime/product-data-migration.json'), 'utf8')).toBe(before);
});

it('accepts the prepared and verified Main receipt and remaps only its historical data file', () => {
  const f = receipts(), before = tree(home);
  expect(preflightProductDataMigrationReceipts(f.current)).toBe(true);
  expect(resolveMigratedDataFile(path.join(f.legacy, 'data/knowledge/original.txt'), f.current)).toBe(path.join(f.current, 'data/knowledge/original.txt'));
  const outside = path.join(home, 'unrelated/knowledge/original.txt'); expect(resolveMigratedDataFile(outside, f.current)).toBe(outside);
  expect(tree(home)).toEqual(before);
});

it('honors an absolute explicit old Designer root and its own verified Designer rename receipts', () => {
  const f = receipts('LumiCore-Designer', 'LumiOS-Designer', 'Lumi Designer');
  process.env.LUMI_DATA_DIR = `  ${f.current}  `;
  expect(hasExplicitDataRoot()).toBe(true); expect(getDataRoot()).toBe(f.current);
  expect(preflightProductDataMigrationReceipts()).toBe(true);
  expect(markLegacyProductDataMigrationVerified({ quickCheck: 'ok', userCount: 1, conversationCount: 2, interactionCount: 3 })).toBe(false);
  expect(resolveMigratedDataFile(path.join(f.legacy, 'data/knowledge/original.txt'))).toBe(path.join(f.current, 'data/knowledge/original.txt'));
  expect(fs.existsSync(path.join(home, 'LumiCore'))).toBe(false);
});

it('uses shared default for blank configuration and rejects relative overrides', () => {
  process.env.LUMI_DATA_DIR = '   '; expect(hasExplicitDataRoot()).toBe(false);
  expect(resolveDefaultDataRoot(home)).toBe(path.join(home, 'LumiCore'));
  process.env.LUMI_DATA_DIR = './LumiCore-Designer'; expect(() => getDataRoot()).toThrow(/absolute path/);
});

it.each(['wrong-product', 'wrong-source', 'wrong-target', 'wrong-root-digest', 'wrong-verification-digest'] as const)('rejects a tampered Main migration receipt: %s', kind => {
  const f = receipts();
  if (kind === 'wrong-product') f.prepared.product = 'Lumi Designer';
  if (kind === 'wrong-source') f.prepared.migratedFrom = path.join(home, 'LumiOS-Designer');
  if (kind === 'wrong-target') f.prepared.migratedTo = path.join(home, 'LumiCore-Designer');
  if (kind === 'wrong-root-digest') f.prepared.targetRootDigest = '0'.repeat(64);
  if (kind === 'wrong-verification-digest') f.verification.migrationReceiptSha256 = '0'.repeat(64);
  write(path.join(f.current, 'runtime/product-data-migration.json'), JSON.stringify(f.prepared) + '\n');
  write(path.join(f.current, 'runtime/product-data-migration-verified.json'), JSON.stringify(f.verification));
  expect(() => preflightProductDataMigrationReceipts(f.current)).toThrow(/receipt/);
});

it('does not treat an arbitrary explicit folder as an old Designer root merely because the receipt claims that product', () => {
  const f = receipts('arbitrary-archive', 'LumiOS-Designer', 'Lumi Designer');
  process.env.LUMI_DATA_DIR = f.current;
  expect(getDataRoot()).toBe(f.current);
  expect(() => preflightProductDataMigrationReceipts()).toThrow(/receipt/);
});
