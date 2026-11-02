import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getIndustryWorkflowContract, getIndustryWorkflowContracts } from '../server/industry/workflow_contracts';
import { getCurrentIndustryCapabilityProfile, matchCurrentIndustryWorkflow } from '../server/regions/packs/cn/industry_capability_profile';

function source(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

describe('spatial and interior design variant', () => {
  it('exposes the five current project contracts through the actual edition profile', () => {
    const contracts = getIndustryWorkflowContracts('design');
    const profile = getCurrentIndustryCapabilityProfile();
    expect(profile?.productLine).toBe('design');
    expect(profile?.entries.map(entry => entry.contract)).toEqual(contracts);
    expect(contracts.map(contract => contract.entryId)).toEqual(['project', 'cad', 'visualization', 'presentation', 'handoff']);
    expect(getIndustryWorkflowContract('design', 'brand-designer')).toBeNull();
  });

  it.each([
    ['project', '执行设计项目阶段'], ['cad', '执行CAD方案阶段'],
    ['visualization', '生成效果图'], ['presentation', '制作提案 PPT'], ['handoff', '执行交付中心阶段'],
  ])('routes an explicit %s request to its live contract', (stage, request) => {
    const match = matchCurrentIndustryWorkflow(request);
    expect(match?.entry.entryId).toBe(stage);
    expect(match?.entry.contract).toBe(getIndustryWorkflowContract('design', stage));
  });

  it('does not activate visualization from a negated request', () => {
    expect(matchCurrentIndustryWorkflow('不要生成效果图。')).toBeNull();
  });

  it('requires source/geometry and real output receipts instead of accepting template text', () => {
    const project = getIndustryWorkflowContract('design', 'project')!;
    const cad = getIndustryWorkflowContract('design', 'cad')!;
    const visual = getIndustryWorkflowContract('design', 'visualization')!;
    expect(project.requiredToolReceipts).toEqual(expect.arrayContaining(['mcp_design-studio-pack_interior_project_brief', 'mcp_design-studio-pack_space_planning_checklist']));
    expect(cad.requiredToolReceipts).toEqual(expect.arrayContaining(['mcp_design-studio-pack_drawing_ingest_qa', 'cad_generate_dxf']));
    expect(cad.requiresFileArtifact).toBe(true);
    expect(cad.acceptedFileExtensions).toEqual(expect.arrayContaining(['.dxf', '.svg']));
    expect(visual.requiredToolReceipts).toEqual(expect.arrayContaining(['mcp_design-studio-pack_interior_visual_direction', 'generate_image']));
    expect(visual.requiresFileArtifact).toBe(true);
    expect(visual.acceptedFileExtensions).not.toContain('.txt');
  });

  it('retains professional review and stops the handoff contract before external delivery', () => {
    const handoff = getIndustryWorkflowContract('design', 'handoff')!;
    expect(handoff.requiredToolReceipts).toContain('design_delivery_package_create');
    expect(handoff.nextActions.join(' ')).toMatch(/stop before external delivery/i);
    expect(handoff.confirmationBoundaries.join(' ')).toMatch(/professional sign-off.*approval/i);
    expect(handoff.executionTools).not.toEqual(expect.arrayContaining(['send_email']));
    for (const contract of getIndustryWorkflowContracts('design')) {
      expect(contract.confirmationBoundaries.join(' ')).toMatch(/review|approval/i);
    }
  });

  it('ships all interior tools and preserves shared general-design compatibility', () => {
    const skill = source('server/skills/bundled/design-studio-pack/index.ts');
    const manifest = JSON.parse(source('server/skills/bundled/design-studio-pack/package.json'));

    expect(manifest.version).toBe('3.1.0');
    expect(manifest.lumi.toolCount).toBe(11);
    expect(manifest.lumi.displayName).toBe('Design Studio Pack');
    expect(skill).toContain("registerTool('interior_project_brief'");
    expect(skill).toContain("registerTool('space_planning_checklist'");
    expect(skill).toContain("registerTool('interior_visual_direction'");
    expect(skill).toContain("registerTool('drawing_ingest_qa'");
    expect(skill).toContain("registerTool('ifc_space_audit_plan'");
    expect(skill).toContain("registerTool('revit_readonly_review_plan'");
    expect(skill).toContain("registerTool('ffe_schedule_normalize'");
    expect(skill).toContain("registerTool('site_survey_report'");
    expect(skill).toContain("registerTool('visual_direction_board'");
    expect(skill).toContain("registerTool('design_review_checklist'");
  });
});
