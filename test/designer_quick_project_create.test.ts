import { describe, expect, it } from 'vitest';
import {
  buildDeterministicDesignProjectCreateCommand,
  isDesignProjectCreateAndSchemeRequest,
} from '../server/cognition/quick_commands';

describe('designer project creation quick route', () => {
  it('binds an explicit named brief to the durable project creation tool', () => {
    const command = buildDeterministicDesignProjectCreateCommand(
      '新建并激活一个室内设计项目，名称“设计师版稳定性验收住宅”，类型为住宅，地点上海浦东，建筑面积89平方米，居住者为两位成人和一名6岁儿童，预算35万元，偏好现代自然风。需求：开放式客餐厅、独立家政区；约束：承重结构未知。请保存 Brief。',
    );
    expect(command?.toolCall).toEqual({
      name: 'interior_design_project_create',
      arguments: expect.objectContaining({
        name: '设计师版稳定性验收住宅',
        projectType: 'residential',
        location: '上海浦东',
        area: '89平方米',
        occupants: '两位成人和一名6岁儿童',
        budget: '35万元',
        style: '现代自然风',
        requirements: '开放式客餐厅、独立家政区',
        constraints: '承重结构未知',
      }),
    });
  });

  it('parses a quoted project name and equals-delimited inline brief fields', () => {
    const request = '新建并激活室内设计项目“暮蓝-26验收住宅”；类型=住宅；地点=上海；面积=88㎡；居住者=2成人1儿童；预算=32万元；风格=侘寂+原木；需求=两室一厅、儿童学习区、充足收纳；约束=不改承重结构、不猜测现场尺寸。请创建持久项目并生成可审核的项目方案。';
    const command = buildDeterministicDesignProjectCreateCommand(request);

    expect(command?.toolCall).toEqual({
      name: 'interior_design_project_create',
      arguments: expect.objectContaining({
        name: '暮蓝-26验收住宅',
        projectType: 'residential',
        location: '上海',
        area: '88㎡',
        occupants: '2成人1儿童',
        budget: '32万元',
        style: '侘寂+原木',
        requirements: '两室一厅、儿童学习区、充足收纳',
        constraints: '不改承重结构、不猜测现场尺寸',
      }),
    });
    expect(isDesignProjectCreateAndSchemeRequest(request)).toBe(true);
  });

  it('does not create a project when the name is missing', () => {
    expect(buildDeterministicDesignProjectCreateCommand('新建一个室内设计项目')).toBeNull();
  });

  it('renders a verified project receipt without claiming later stages', () => {
    const command = buildDeterministicDesignProjectCreateCommand('新建室内设计项目，名称“验收项目”');
    const text = command?.formatToolResult?.(JSON.stringify({
      ok: true,
      status: 'created',
      persisted: true,
      active: true,
      project: {
        id: 'project-1',
        name: '验收项目',
        projectType: 'residential',
        brief: { location: '', area: '', occupants: '', budget: '', style: '', requirements: '', constraints: '' },
      },
    }));
    expect(text).toContain('项目已创建并激活');
    expect(text).toContain('未生成 CAD、效果图或 PPT');
    expect(text).toContain('未发送给客户');
  });
});
