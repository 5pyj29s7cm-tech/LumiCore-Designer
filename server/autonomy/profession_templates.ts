/**
 * Designer-only profession prompt shape.
 *
 * The old implementation installed background "profession agents" into the
 * database.  LumiCore now keeps one execution owner, so that side effect was
 * removed.  The type remains as a compatibility contract for the Designer
 * region pack, while discovery intentionally returns no autonomous agents.
 */
export interface DesignerProfessionTemplate {
  name: string;
  description: string;
  category: string;
  territory: string;
  initialPrompt: string;
  knowledgeDomains: string[];
  toolRecommendations: string[];
  modelRecommendation: string;
}

/** @deprecated Use DesignerProfessionTemplate; retained for region-pack typing only. */
export type AgentTemplate = DesignerProfessionTemplate;

/**
 * Compatibility read API.  Profession-specific autonomous installation is no
 * longer part of the runtime; callers receive an empty list and should use
 * LumiCore's normal capability routing instead.
 */
export function getProfessionTemplates(_profession: string): DesignerProfessionTemplate[] {
  return [];
}

/** @deprecated Autonomous profession-agent installation was intentionally removed. */
export function installProfessionAgents(_orgId?: string): number {
  return 0;
}
