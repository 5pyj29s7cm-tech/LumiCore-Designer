import type { MCPServerConfig } from '../mcp/client';

/** Designer inherits the complete Main runtime. Existing skills remain enabled. */
export function selectNonDefaultVariantSkillsToDisable(
  _configured: Record<string, MCPServerConfig>,
  _defaults: readonly string[],
): string[] { return []; }

/** Compatibility entry point: edition branding must never disable inherited capabilities. */
export function enforceProductVariantSkillBaseline(): string[] { return []; }
