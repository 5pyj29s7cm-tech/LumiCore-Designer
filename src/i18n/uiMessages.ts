import uiMessageData from './locales/ui.generated.json';
import { getLocale, type Locale } from './runtime';

export type UiMessageKey = keyof typeof uiMessageData;

type UiMessageValue = string | number | boolean | null | undefined;
type LocalizedUiMessageValue = UiMessageValue | { en: UiMessageValue; zh: UiMessageValue };

// Variants can advance shared UI surfaces ahead of the generated catalog. Keep
// the lookup tolerant so a missing generated key never blocks a build or
// renders an opaque hash in the client.
const SHARED_FALLBACKS: Record<string, { en: string; zh: string }> = {
  'command-center.switcher.4b7c2d1e09': { en: 'Command Center destinations', zh: '指挥中心入口' },
  'agent-chat-page.memory-avatar.8c4e1f7a20': { en: 'Memory Avatar', zh: '记忆化身' },
  'agent-chat-page.open-memory-avatar.2d7a9c4e16': { en: 'Open Memory Avatar', zh: '打开记忆化身' },
  'command-center.memory-avatar-hint.6a1d9e3c20': { en: 'Open memory avatars', zh: '打开记忆化身' },
  'command-center.inner-realm.4d8f2a1c09': { en: 'LumiCore', zh: '灵息之境' },
  'command-center.lumicore-hint.8f2d4c1a09': { en: 'Open LumiCore runtime', zh: '打开灵息之境' },
};

export function uiMessage(key: UiMessageKey | string, locale: Locale = getLocale()): string {
  const entry = uiMessageData[key] as { en: string; zh: string } | undefined;
  const fallback = SHARED_FALLBACKS[key];
  if (!entry && !fallback) return key;
  if (!entry) return fallback[locale] || fallback.en || key;
  return entry[locale] || entry.en || key;
}

export function formatUiMessage(
  key: UiMessageKey | string,
  values: Record<string, LocalizedUiMessageValue>,
  locale: Locale = getLocale(),
): string {
  return uiMessage(key, locale).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value && typeof value === 'object' && 'en' in value && 'zh' in value) {
      return String(value[locale] ?? '');
    }
    return String(value ?? '');
  });
}
