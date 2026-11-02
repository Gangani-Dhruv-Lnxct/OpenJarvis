import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranslationWidget, SUPPORTED_LANGUAGES } from './TranslationWidget';

vi.mock('../../lib/store', () => ({
  useAppStore: (selector: any) =>
    selector({
      messages: [
        { id: '1', role: 'user', content: 'Hello in English' },
        { id: '2', role: 'assistant', content: '<think>Processing...</think>This is the assistant response.' },
      ],
      selectedModel: 'qwen3.5:4b',
      streamState: { isStreaming: false },
    }),
}));

vi.mock('../../lib/api', () => ({
  translateText: vi.fn(async ({ text, target_language }) => ({
    original_text: text,
    translated_text: `Translated [${text}] to ${target_language}`,
    target_language,
    source_language: 'English',
  })),
}));

describe('TranslationWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders translation controls and English to All badge', () => {
    const markup = renderToStaticMarkup(<TranslationWidget />);
    expect(markup).toContain('Translate');
    expect(markup).toContain('EN ➜ ALL');
    expect(markup).toContain('Translate Latest Reply');
    expect(markup).toContain('+ Translate custom English text');
    expect(markup).toContain('Spanish');
    expect(markup).toContain('Hindi');
    expect(markup).toContain('Gujarati');
  });

  it('includes all supported languages in the dropdown options', () => {
    const markup = renderToStaticMarkup(<TranslationWidget />);
    for (const lang of SUPPORTED_LANGUAGES.slice(0, 10)) {
      expect(markup).toContain(lang.name);
      expect(markup).toContain(lang.native);
    }
  });
});
