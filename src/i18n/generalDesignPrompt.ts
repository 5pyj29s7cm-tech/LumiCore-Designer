import { getLocale, type Locale } from './runtime';

export function buildGeneralDesignPrompt(role: string, outputGuide: string, input: string, locale: Locale = getLocale()): string {
  const copy = locale === 'zh'
    ? { modules: '请按以下模块输出：', needs: '用户需求：' }
    : { modules: 'Use the following output sections:', needs: 'User requirements:' };
  return `${role}\n\n${copy.modules}\n${outputGuide}\n\n${copy.needs}\n${input}`;
}
