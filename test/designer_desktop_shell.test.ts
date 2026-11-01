import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('Designer desktop shell', () => {
  it('exposes the five outcome workspaces on the primary desktop', () => {
    const desktop = read('src/components/desktop/desktop_windows_view.tsx');
    const registry = read('shared/client_surfaces.ts');
    const icons = read('src/components/desktop/state/use_desktop_capture_and_identity.tsx');
    const copy = read('src/i18n/locales/interiorDesign.ts');

    for (const id of ['design-project', 'design-cad', 'design-visualization', 'design-presentation', 'design-handoff']) {
      expect(registry).toContain(`id: '${id}'`);
    }
    for (const label of ['设计项目', 'CAD 方案', '效果图', '提案 PPT', '交付中心']) {
      expect(copy).toContain(label);
    }
    expect(desktop).toContain('<DesignHub initialView=');
    expect(icons).toContain('interiorDesignMessage(label');
    expect(icons).toContain('business-finance');
    expect(icons).toContain('business-ecommerce');
    expect(read('src/components/desktop/shell_chrome_view.tsx')).toContain('{PRODUCT_VARIANT.runtime.productName}');
  });

  it('opens the existing task-backed DesignHub instead of a prompt-only placeholder', () => {
    const hub = read('src/components/org/DesignHub.tsx');
    const hook = read('src/hooks/useDesignChat.ts');
    expect(hook).toContain('startIndustryWorkflow');
    expect(hook).toContain('executeIndustryWorkflow');
    expect(hub).toContain('workflowTaskId');
    expect(read('src/services/apiClient.ts')).toContain("next.set('x-lumi-desktop-session', desktopSessionProof)");
    expect(hub).toContain("initialView = 'project'");
  });

  it('renders five distinct business workspaces instead of one renamed form', () => {
    const hub = read('src/components/org/DesignHub.tsx');
    const workspaceCopy = read('src/i18n/locales/designerWorkspaces.ts');

    expect(hub).toContain("props.entryId === 'project') return <ProjectWorkspace");
    expect(hub).toContain("props.entryId === 'cad') return <CadWorkspace");
    expect(hub).toContain("props.entryId === 'visualization') return <VisualizationWorkspace");
    expect(hub).toContain("props.entryId === 'presentation') return <PresentationWorkspace");
    expect(hub).toContain('return <HandoffWorkspace');
    expect(hub).toContain('VIEW_PRESENTATION');
    expect(hub).toContain('data-design-workspace={view}');
    expect(hub).toContain("view === 'project' ? (");
    for (const workspace of ['项目驾驶舱', '图纸校核台', '效果图制作台', '提案编排台', '交付核验台']) {
      expect(workspaceCopy).toContain(workspace);
    }
  });

  it('allows standalone work while reusing project context when one is selected', () => {
    const hub = read('src/components/org/DesignHub.tsx');
    const panel = read('src/components/org/InteriorProjectPanel.tsx');
    const client = read('src/lib/interiorProjects.ts');

    expect(hub).toContain("activeProject?.id || 'standalone'");
    expect(read('src/hooks/useDesignChat.ts')).toContain("source: workflow.projectId ? 'designer_project_workspace' : 'designer_standalone_workspace'");
    expect(hub).toContain('project={activeProject}');
    expect(panel).toContain("m('standaloneTask')");
    expect(client).toContain("'/api/personal/interior/projects'");
    expect(client).toContain("'/api/org/interior/projects'");
  });
});
