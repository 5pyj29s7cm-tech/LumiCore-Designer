import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEPRECATED_GENERIC_DESIGN_TEMPLATE_NAMES_CN,
  INTERIOR_DESIGN_TEMPLATES_CN,
} from '../server/regions/packs/cn/interior_design_templates';

function source(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

describe('spatial and interior design variant', () => {
  it('installs only spatial and interior specialist templates', () => {
    expect(INTERIOR_DESIGN_TEMPLATES_CN.map(template => template.name)).toEqual([
      '空间规划师',
      '室内设计师',
      '建筑条件协调顾问',
      '室内可视化师',
    ]);

    const searchable = JSON.stringify(INTERIOR_DESIGN_TEMPLATES_CN);
    expect(searchable).not.toMatch(/品牌设计|Logo|UI\/UX|外立面设计|建筑体量设计/);
    expect(searchable).toMatch(/空间规划/);
    expect(searchable).toMatch(/室内设计/);
    expect(searchable).toMatch(/既有条件|建筑条件/);
    expect([...DEPRECATED_GENERIC_DESIGN_TEMPLATE_NAMES_CN]).toEqual(expect.arrayContaining([
      '品牌设计师',
      'UI/UX 审查师',
      '设计规范师',
    ]));
  });

  it('ships focused skill tools instead of generic brand and UI tools', () => {
    const skill = source('server/skills/bundled/design-studio-pack/index.ts');
    const manifest = JSON.parse(source('server/skills/bundled/design-studio-pack/package.json'));

    expect(manifest.version).toBe('3.0.0');
    expect(manifest.lumi.toolCount).toBe(8);
    expect(manifest.lumi.displayName).toBe('Spatial & Interior Studio');
    expect(skill).toContain("registerTool('interior_project_brief'");
    expect(skill).toContain("registerTool('space_planning_checklist'");
    expect(skill).toContain("registerTool('interior_visual_direction'");
    expect(skill).toContain("registerTool('drawing_ingest_qa'");
    expect(skill).toContain("registerTool('ifc_space_audit_plan'");
    expect(skill).toContain("registerTool('revit_readonly_review_plan'");
    expect(skill).toContain("registerTool('ffe_schedule_normalize'");
    expect(skill).toContain("registerTool('site_survey_report'");
    expect(skill).not.toContain("registerTool('visual_direction_board'");
    expect(skill).not.toContain("registerTool('design_review_checklist'");
  });
});
