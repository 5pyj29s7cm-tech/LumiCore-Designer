/**
 * Pre-built spatial/interior agent templates for the organization marketplace.
 * Locale-specific template copy lives in the matching region pack.
 */
import * as EDB from '../org/db';
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

export function installDesignTemplates(orgId: string): number {
  for (const template of EDB.listTemplates(orgId, { category: 'design' })) {
    if (
      template.authorId === 'system'
      && template.status !== 'rejected'
      && DEPRECATED_GENERIC_DESIGN_TEMPLATE_NAMES_CN.has(template.name)
    ) {
      EDB.updateTemplateStatus(
        orgId,
        template.id,
        'rejected',
        'system',
        'Retired by the spatial/interior product scope migration.',
      );
    }
  }

  let installed = 0;
  for (const def of DESIGN_TEMPLATES) {
    const existing = EDB.listTemplates(orgId, { category: 'design' });
    if (existing.some(template => template.name === def.name)) continue;

    EDB.createTemplate(orgId, 'system', {
      name: def.name,
      description: def.description,
      category: def.category,
      config: def.config,
      icon: def.icon,
    });

    const templates = EDB.listTemplates(orgId, { category: 'design' });
    const created = templates.find(template => template.name === def.name);
    if (created) {
      EDB.updateTemplateStatus(orgId, created.id, 'approved', 'system');
      EDB.updateTemplateStatus(orgId, created.id, 'published', 'system');
      installed++;
    }
  }
  return installed;
}
