/**
 * Pre-built spatial/interior agent templates for the organization marketplace.
 * Locale-specific template copy lives in the matching region pack.
 */
import {
  DEPRECATED_GENERIC_DESIGN_TEMPLATE_NAMES_CN,
  INTERIOR_DESIGN_TEMPLATES_CN,
} from '../regions/packs/cn/interior_design_templates';

export interface DesignTemplateDef {
  name: string;
  description: string;
  category: string;
  icon: string;
  config: {
    initialPrompt: string;
    tools: string[];
    knowledgeDomains: string[];
    autonomyLevel: 'supervised' | 'semi_autonomous' | 'fully_autonomous';
  };
}

export const DESIGN_TEMPLATES: DesignTemplateDef[] = INTERIOR_DESIGN_TEMPLATES_CN;

/**
 * Legacy installation hook retained for Designer integrations.  The shared
 * agent-template registry was retired with the multi-agent workspace; these
 * definitions are now consumed as static LumiCore prompt/capability hints and
 * are never persisted as autonomous agents.
 */
export function installDesignTemplates(orgId: string): number {
  void orgId;
  void DEPRECATED_GENERIC_DESIGN_TEMPLATE_NAMES_CN;
  return 0;
}
