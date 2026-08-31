/**
 * Pre-built spatial/interior workflow templates for Designer capabilities.
 * Locale-specific template copy lives in the matching region pack.
 */
import { INTERIOR_DESIGN_TEMPLATES_CN } from '../regions/packs/cn/interior_design_templates';

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
