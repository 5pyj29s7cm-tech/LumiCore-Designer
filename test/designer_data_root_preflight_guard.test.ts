import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// This suite tests startup ordering only. The global isolation teardown must
// not initialize SQLite through the deliberately mocked path/lease owners.
vi.mock('../db_layer', () => ({ closeDatabase: vi.fn() }));

const owners = vi.hoisted(() => ({ explicit: vi.fn(), currentRoot: vi.fn(), defaultRoot: vi.fn(), guard: vi.fn(), migrate: vi.fn(), receipts: vi.fn(), acquire: vi.fn(), release: vi.fn(), claim: vi.fn() }));
vi.mock('../server/config/data_path', () => ({ hasExplicitDataRoot: owners.explicit, assertLegacyDesignerDataMerged: owners.guard,
  getDataRoot: owners.currentRoot, resolveDefaultDataRoot: owners.defaultRoot,
  migrateLegacyProductDataRoot: owners.migrate, preflightProductDataMigrationReceipts: owners.receipts }));
vi.mock('../server/runtime/data_root_lease', () => ({ acquireDataRootLease: owners.acquire, releaseDataRootLease: owners.release, claimDataRootForMigration: owners.claim }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); owners.explicit.mockReturnValue(false); owners.guard.mockReset(); owners.receipts.mockReset();
  owners.currentRoot.mockReturnValue('D:/synthetic-home/LumiCore-Designer'); owners.defaultRoot.mockReturnValue('D:/synthetic-home/LumiCore');
  vi.stubEnv('VITEST', 'true'); vi.stubEnv('LUMI_ENFORCE_DATA_ROOT_LEASE', '1'); vi.stubEnv('NODE_ENV', 'production');
});
afterEach(() => vi.unstubAllEnvs());

it('refuses unreviewed default history before migration, lease acquisition or receipt initialization', async () => {
  owners.guard.mockImplementation(() => { throw Error('Unreviewed Designer history'); });
  const { prepareRuntimeDataRoot } = await import('../server/runtime/data_root_preflight');
  expect(() => prepareRuntimeDataRoot()).toThrow('Unreviewed Designer history');
  expect(owners.migrate).not.toHaveBeenCalled(); expect(owners.acquire).not.toHaveBeenCalled(); expect(owners.receipts).not.toHaveBeenCalled();
});

it('validates default merge history first, then preserves the exclusive migration and receipt order exactly once', async () => {
  const { prepareRuntimeDataRoot } = await import('../server/runtime/data_root_preflight'); prepareRuntimeDataRoot(); prepareRuntimeDataRoot();
  expect(owners.guard).toHaveBeenCalledTimes(1); expect(owners.migrate).toHaveBeenCalledWith(owners.claim);
  expect(owners.guard.mock.invocationCallOrder[0]).toBeLessThan(owners.migrate.mock.invocationCallOrder[0]);
  expect(owners.migrate.mock.invocationCallOrder[0]).toBeLessThan(owners.acquire.mock.invocationCallOrder[0]);
  expect(owners.acquire.mock.invocationCallOrder[0]).toBeLessThan(owners.receipts.mock.invocationCallOrder[0]);
  expect(owners.acquire).toHaveBeenCalledTimes(1);
});

it('keeps an explicit old Designer root outside default migration while retaining lease and receipt checks', async () => {
  owners.explicit.mockReturnValue(true);
  const { prepareRuntimeDataRoot } = await import('../server/runtime/data_root_preflight'); prepareRuntimeDataRoot();
  expect(owners.guard).not.toHaveBeenCalled(); expect(owners.migrate).not.toHaveBeenCalled();
  expect(owners.acquire).toHaveBeenCalledTimes(1); expect(owners.receipts).toHaveBeenCalledTimes(1);
});

it('does not bypass the history guard by spelling the canonical shared root in the explicit override', async () => {
  owners.explicit.mockReturnValue(true); owners.currentRoot.mockReturnValue('D:/synthetic-home/LumiCore');
  owners.guard.mockImplementation(() => { throw Error('Unreviewed shared root'); });
  const { prepareRuntimeDataRoot } = await import('../server/runtime/data_root_preflight');
  expect(() => prepareRuntimeDataRoot()).toThrow('Unreviewed shared root');
  expect(owners.migrate).not.toHaveBeenCalled(); expect(owners.acquire).not.toHaveBeenCalled();
});

it('releases the acquired lease and permits retry after a receipt validation failure', async () => {
  owners.receipts.mockImplementationOnce(() => { throw Error('Receipt invalid'); });
  const { prepareRuntimeDataRoot } = await import('../server/runtime/data_root_preflight');
  expect(() => prepareRuntimeDataRoot()).toThrow('Receipt invalid'); expect(owners.release).toHaveBeenCalledTimes(1);
  prepareRuntimeDataRoot(); expect(owners.acquire).toHaveBeenCalledTimes(2); expect(owners.guard).toHaveBeenCalledTimes(2);
});
