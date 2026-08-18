import { describe, expect, it } from 'vitest';
import { normalizeActionIntent } from '../server/cognition/normalized_action_intent';

describe('normalized desktop intent priority', () => {
  it('recognizes a concrete local application target', () => {
    expect(normalizeActionIntent('帮我打开记事本')).toMatchObject({
      kind: 'desktop_operation',
      operation: 'navigate',
      target: '记事本',
      sideEffectClass: 'none',
    });
  });

  it('keeps Lumi client navigation ahead of generic desktop control', () => {
    expect(normalizeActionIntent('打开聊天界面')).toMatchObject({
      kind: 'client_navigation',
      clientAction: 'open_chat',
    });
  });

  it('maps the Chinese command-center label to the native Lumi surface', () => {
    expect(normalizeActionIntent('打开 Lumi 指挥中心')).toMatchObject({
      kind: 'client_navigation',
      operation: 'navigate',
      target: 'command-center',
      sideEffectClass: 'none',
      clientAction: 'open_command_center',
    });
  });

  it('keeps inbound semantic roles ahead of action-shaped words', () => {
    expect(normalizeActionIntent('张勇给我发了什么')).toMatchObject({
      kind: 'messaging_read',
      sideEffectClass: 'none',
    });
  });

  it('keeps external AI history in its own read-only lane', () => {
    expect(normalizeActionIntent('读取 ChatGPT 里的聊天历史并同步新增消息')).toMatchObject({
      kind: 'external_ai_history',
      operation: 'read',
      target: 'ChatGPT',
      sideEffectClass: 'none',
      rule: 'external-ai-history-read',
    });
    expect(normalizeActionIntent('Lumi 可以读取外部 AI 里的聊天内容吗？')).toMatchObject({
      kind: 'external_ai_history',
      operation: 'read',
      target: 'external_ai',
      sideEffectClass: 'none',
    });
  });

  it('does not turn a fresh external AI prompt into history access', () => {
    expect(normalizeActionIntent('问问 ChatGPT 并让它回答聊天历史应该怎么迁移')).not.toMatchObject({
      kind: 'external_ai_history',
    });
  });

  it('ignores negated navigation while preserving an explicit image-generation request', () => {
    expect(normalizeActionIntent('\u751f\u6210\u4e00\u5f20\u771f\u5b9e\u672c\u5730\u6548\u679c\u56fe\uff0c\u4e0d\u8981\u6253\u5f00\u6216\u4fee\u6539\u5916\u90e8\u8f6f\u4ef6\uff0c\u4e0d\u8981\u5916\u53d1')).toMatchObject({
      kind: 'media_generation',
      operation: 'create',
      target: 'image',
      sideEffectClass: 'external_commit',
    });
    expect(normalizeActionIntent('\u4e0d\u8981\u751f\u6210\u6548\u679c\u56fe\uff0c\u53ea\u67e5\u8be2\u5f53\u524d\u9879\u76ee\u72b6\u6001')).not.toMatchObject({
      kind: 'media_generation',
    });
  });

  it('keeps an explicit proposal PPT workflow separate from referenced CAD prerequisites', () => {
    expect(normalizeActionIntent('\u7ee7\u7eed\u5f53\u524d\u9879\u76ee\uff0c\u6267\u884c\u201c\u63d0\u6848 PPT\u201d\u9636\u6bb5\uff0cPPT \u5fc5\u987b\u7ee7\u627f\u5df2\u9a8c\u8bc1\u7684\u9879\u76ee\u65b9\u6848\u3001CAD \u548c\u6548\u679c\u56fe\u56de\u6267\u3002')).toMatchObject({
      kind: 'document_creation',
      operation: 'create',
      target: 'presentation',
      sideEffectClass: 'local_write',
      relation: 'continue',
    });
  });
});
