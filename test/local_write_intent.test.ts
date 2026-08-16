import { describe, expect, it } from 'vitest';
import { shouldAllowExplicitLocalFileWrite } from '../server/cognition/local_write_intent';

describe('explicit local-write intent', () => {
  it.each(['chat', 'voice', 'rest_chat'])('authorizes the same local CAD deliverable in %s', () => {
    expect(shouldAllowExplicitLocalFileWrite('生成本地DXF和SVG预览并核验，不打开外部软件。')).toBe(true);
  });

  it('does not authorize a negated generation request', () => {
    expect(shouldAllowExplicitLocalFileWrite('先不要生成CAD或DXF，只检查资料。')).toBe(false);
  });

  it('does not treat an ordinary design conversation as a file-write request', () => {
    expect(shouldAllowExplicitLocalFileWrite('这个空间的动线有哪些风险？')).toBe(false);
  });

  it.each([
    '生成本地交付包并核验归档，不发送给客户。',
    '为客餐厅生成一张本地效果图，只做内部评审。',
    '制作本地提案演示文稿并导出 PDF。',
  ])('authorizes common local design deliverables: %s', request => {
    expect(shouldAllowExplicitLocalFileWrite(request)).toBe(true);
  });
});
