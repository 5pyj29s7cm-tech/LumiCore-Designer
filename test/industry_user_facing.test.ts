import { describe, expect, it } from 'vitest';
import {
  formatIndustryWorkflowPrerequisiteBlocker,
  humanizeIndustryWorkflowResponse,
  mergeIndustryWorkflowFinalState,
} from '../server/industry/user_facing';

describe('industry workflow user-facing copy', () => {
  it('removes internal task ids and tool names while preserving the real blocker', () => {
    const text = humanizeIndustryWorkflowResponse(
      '任务 `wt_task_123_abc` 的 `generate_image` 调用失败：DashScope Arrearage。未调用完成校验。',
    );

    expect(text).toContain('当前任务');
    expect(text).toContain('图片生成服务');
    expect(text).toContain('DashScope Arrearage');
    expect(text).toContain('没有标记为完成');
    expect(text).not.toContain('wt_task_');
    expect(text).not.toContain('generate_image');
  });

  it('explains design-stage dependencies without internal identifiers', () => {
    const text = formatIndustryWorkflowPrerequisiteBlocker({
      projectName: '矩衡验收户型A',
      entryId: 'handoff',
      missing: ['visualization', 'presentation'],
    });

    expect(text).toContain('交付中心');
    expect(text).toContain('效果图、提案 PPT');
    expect(text).toContain('没有生成或覆盖下游文件');
    expect(text).not.toContain('wt_task_');
  });
});

describe('industry workflow final HTTP state', () => {
  it('reports a failed persistent verification as blocked even when narration finalization passed', () => {
    expect(mergeIndustryWorkflowFinalState(
      { blocked: false },
      { verification: { passed: false, summary: 'A real presentation file is required.' } },
    )).toMatchObject({
      blocked: true,
      reason: 'A real presentation file is required.',
      notification: { type: 'industry_workflow_guard' },
    });
  });

  it('preserves a stronger model/tool finalizer blocker', () => {
    expect(mergeIndustryWorkflowFinalState(
      { blocked: true, reason: 'Tool failed.', notification: { type: 'work_product_guard' } },
      { verification: { passed: false, summary: 'Artifact missing.' } },
    )).toEqual({
      blocked: true,
      reason: 'Tool failed.',
      notification: { type: 'work_product_guard' },
    });
  });
});
