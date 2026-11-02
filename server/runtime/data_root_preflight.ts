import {
  assertLegacyDesignerDataMerged,
  getDataRoot,
  hasExplicitDataRoot,
  migrateLegacyProductDataRoot,
  preflightProductDataMigrationReceipts,
  resolveDefaultDataRoot,
} from '../config/data_path';
import { normalizePathIdentity } from '../../shared/file_identity';
import {
  acquireDataRootLease,
  claimDataRootForMigration,
  releaseDataRootLease,
} from './data_root_lease';

let runtimeDataRootPrepared = false;

/**
 * Establish the sole data-root ownership boundary before the application graph
 * is evaluated. `db_layer` also calls this as a compatibility fallback for
 * direct imports, but this process-local fence makes migration and receipt
 * validation execute only once.
 */
export function prepareRuntimeDataRoot(): void {
  if (runtimeDataRootPrepared) return;

  // Vitest workers intentionally share and reload modules. Cross-process lease
  // fixtures explicitly opt back into the production boundary.
  if (process.env.VITEST === 'true' && process.env.LUMI_ENFORCE_DATA_ROOT_LEASE !== '1') {
    return;
  }

  const explicitRoot = hasExplicitDataRoot();
  if (process.env.NODE_ENV !== 'test' && (!explicitRoot
    || normalizePathIdentity(getDataRoot()) === normalizePathIdentity(resolveDefaultDataRoot()))) {
    assertLegacyDesignerDataMerged();
  }
  if (!explicitRoot && process.env.NODE_ENV !== 'test') {
    migrateLegacyProductDataRoot(claimDataRootForMigration);
  }

  acquireDataRootLease();
  try {
    preflightProductDataMigrationReceipts();
  } catch (error) {
    releaseDataRootLease();
    throw error;
  }
  runtimeDataRootPrepared = true;
}
