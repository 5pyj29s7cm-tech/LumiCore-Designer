import { describe, expect, it } from 'vitest';
import { parseDeepSeekResponse, parseLegacyXmlToolCalls } from '../server/llm/providers';

describe('legacy XML tool protocol compatibility', () => {
  const declarations = [
    {
      type: 'function' as const,
      function: { name: 'set_client_mode', description: '', parameters: {} },
    },
    {
      type: 'function' as const,
      function: { name: 'client_get_state', description: '', parameters: {} },
    },
    {
      type: 'function' as const,
      function: { name: 'industry_workflow_start', description: '', parameters: {} },
    },
  ];

  it('converts declared XML invocations into structured calls', () => {
    expect(parseLegacyXmlToolCalls(
      '<function_calls><invoke name="set_client_mode"><parameter name="mode">assistant</parameter></invoke></function_calls>',
      declarations,
    )).toEqual([expect.objectContaining({
      name: 'set_client_mode',
      arguments: { mode: 'assistant' },
    })]);
  });

  it('converts the DeepSeek full-width DSML variant into a declared structured call', () => {
    expect(parseLegacyXmlToolCalls(
      '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="industry_workflow_start"><｜｜DSML｜｜parameter name="entryId" string="true">visualization</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
      declarations,
    )).toEqual([expect.objectContaining({
      name: 'industry_workflow_start',
      arguments: { entryId: 'visualization' },
    })]);
  });

  it('normalizes DSML in a non-streaming OpenAI-compatible response', () => {
    const parsed = parseDeepSeekResponse({
      choices: [{
        message: {
          content: '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="industry_workflow_start"><｜｜DSML｜｜parameter name="entryId" string="true">visualization</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
        },
      }],
    }, declarations);

    expect(parsed.text).toBeNull();
    expect(parsed.toolCalls).toEqual([expect.objectContaining({
      name: 'industry_workflow_start',
      arguments: { entryId: 'visualization' },
    })]);
  });

  it('does not execute undeclared XML tool names', () => {
    expect(parseLegacyXmlToolCalls(
      '<function_calls><invoke name="desktop_run_command"><parameter name="command">whoami</parameter></invoke></function_calls>',
      declarations,
    )).toBeNull();
  });
});
