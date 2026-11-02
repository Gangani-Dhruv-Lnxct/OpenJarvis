import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Globe,
  Languages,
  Copy,
  Check,
  Volume2,
  Square,
  Sparkles,
  ArrowRight,
  Loader2,
  X,
} from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { translateText } from '../../lib/api';
import { stripThinkTags } from '../../lib/message-text';

export interface SupportedLanguage {
  code: string;
  name: string;
  native: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'es-ES', name: 'Spanish', native: 'Español' },
  { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी' },
  { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'fr-FR', name: 'French', native: 'Français' },
  { code: 'de-DE', name: 'German', native: 'Deutsch' },
  { code: 'zh-CN', name: 'Chinese', native: '简体中文' },
  { code: 'ja-JP', name: 'Japanese', native: '日本語' },
  { code: 'ar-SA', name: 'Arabic', native: 'العربية' },
  { code: 'ru-RU', name: 'Russian', native: 'Русский' },
  { code: 'pt-BR', name: 'Portuguese', native: 'Português' },
  { code: 'it-IT', name: 'Italian', native: 'Italiano' },
  { code: 'ko-KR', name: 'Korean', native: '한국어' },
  { code: 'bn-IN', name: 'Bengali', native: 'বাংলা' },
  { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te-IN', name: 'Telugu', native: 'తెలుగు' },
  { code: 'mr-IN', name: 'Marathi', native: 'मराठी' },
  { code: 'ur-PK', name: 'Urdu', native: 'اردو' },
  { code: 'tr-TR', name: 'Turkish', native: 'Türkçe' },
  { code: 'nl-NL', name: 'Dutch', native: 'Nederlands' },
  { code: 'vi-VN', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'id-ID', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'th-TH', name: 'Thai', native: 'ไทย' },
  { code: 'pl-PL', name: 'Polish', native: 'Polski' },
  { code: 'uk-UA', name: 'Ukrainian', native: 'Українська' },
  { code: 'el-GR', name: 'Greek', native: 'Ελληνικά' },
  { code: 'sv-SE', name: 'Swedish', native: 'Svenska' },
];

const POPULAR_LANGUAGES = ['Spanish', 'Hindi', 'Gujarati', 'French', 'German', 'Japanese', 'Chinese'];

function getSafeStorage(key: string, fallback: string): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key) || fallback;
    }
  } catch {}
  return fallback;
}

function setSafeStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {}
}

export function TranslationWidget() {
  const messages = useAppStore((s) => s.messages);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const isStreaming = useAppStore((s) => s.streamState.isStreaming);

  const [selectedLang, setSelectedLang] = useState<string>(() => {
    return getSafeStorage('openjarvis-target-lang', 'Spanish');
  });

  const [autoTranslate, setAutoTranslate] = useState<boolean>(() => {
    return getSafeStorage('openjarvis-auto-translate', 'false') === 'true';
  });

  const [customText, setCustomText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [lastTranslatedSource, setLastTranslatedSource] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);

  const lastAutoTranslatedIdRef = useRef<string | null>(null);

  // Persist language preference
  const handleSelectLanguage = (langName: string) => {
    setSelectedLang(langName);
    setSafeStorage('openjarvis-target-lang', langName);
    // If we have an existing translation, re-translate if source is present
    if (lastTranslatedSource.trim()) {
      doTranslate(lastTranslatedSource, langName);
    }
  };

  const handleToggleAutoTranslate = () => {
    setAutoTranslate((prev) => {
      const next = !prev;
      setSafeStorage('openjarvis-auto-translate', String(next));
      return next;
    });
  };

  const currentLangObj = SUPPORTED_LANGUAGES.find((l) => l.name === selectedLang) || SUPPORTED_LANGUAGES[0];

  const doTranslate = useCallback(async (textToTranslate: string, targetLanguageName: string) => {
    const cleaned = stripThinkTags(textToTranslate).trim();
    if (!cleaned) return;

    setIsLoading(true);
    setErrorMessage(null);
    setLastTranslatedSource(cleaned);

    try {
      const res = await translateText({
        text: cleaned,
        target_language: targetLanguageName,
        source_language: 'English',
        model: selectedModel || undefined,
      });

      setTranslatedText(res.translated_text);
    } catch (err: any) {
      let msg = err?.message || 'Translation failed';
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.detail) {
          msg = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
        }
      } catch {}
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  }, [selectedModel]);

  // Translate the latest assistant reply
  const handleTranslateLatestReply = () => {
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    if (assistantMessages.length === 0) {
      setErrorMessage('No assistant reply found in chat to translate.');
      return;
    }
    const lastMsg = assistantMessages[assistantMessages.length - 1];
    doTranslate(lastMsg.content, selectedLang);
  };

  // Auto-translate listener
  useEffect(() => {
    if (!autoTranslate || isStreaming) return;

    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    if (assistantMessages.length === 0) return;

    const lastMsg = assistantMessages[assistantMessages.length - 1];
    if (lastMsg.id !== lastAutoTranslatedIdRef.current) {
      lastAutoTranslatedIdRef.current = lastMsg.id;
      doTranslate(lastMsg.content, selectedLang);
    }
  }, [autoTranslate, isStreaming, messages, selectedLang, doTranslate]);

  // Copy translated text
  const handleCopy = async () => {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  // Text-to-speech for target language
  const handleSpeak = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    if (!translatedText.trim()) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(translatedText);
    utterance.lang = currentLangObj.code;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  // Cancel speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return (
    <section className="flex flex-col gap-2.5">
      {/* Header with Title and Auto-Translate Switch */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Globe size={13} style={{ color: 'var(--color-accent)' }} />
          <h4
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Translate
          </h4>
          <span
            className="text-[9px] px-1.5 py-0.2 rounded font-mono font-medium"
            style={{
              background: 'var(--color-accent-subtle)',
              color: 'var(--color-accent)',
            }}
          >
            EN ➜ ALL
          </span>
        </div>

        {/* Auto-Translate Toggle */}
        <button
          onClick={handleToggleAutoTranslate}
          title={autoTranslate ? 'Auto-translate new replies is ON' : 'Turn on auto-translate for new replies'}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer"
          style={{
            background: autoTranslate ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)',
            border: autoTranslate ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
            color: autoTranslate ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          }}
        >
          <span>Auto</span>
          <span
            className="text-[9px] font-semibold px-1 rounded-sm"
            style={{
              background: autoTranslate ? 'var(--color-accent)' : 'transparent',
              color: autoTranslate ? '#fff' : 'inherit',
            }}
          >
            {autoTranslate ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>

      {/* Target Language Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Languages size={12} style={{ color: 'var(--color-text-tertiary)' }} />
          <label htmlFor="target-lang-select" className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            Target Language:
          </label>
        </div>

        <select
          id="target-lang-select"
          value={selectedLang}
          onChange={(e) => handleSelectLanguage(e.target.value)}
          className="w-full text-xs rounded-lg px-2.5 py-1.5 cursor-pointer outline-none transition-colors"
          style={{
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang.name} value={lang.name} style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
              {lang.name} ({lang.native})
            </option>
          ))}
        </select>

        {/* Quick popular language pills */}
        <div className="flex flex-wrap gap-1 mt-0.5">
          {POPULAR_LANGUAGES.map((langName) => {
            const isSelected = selectedLang === langName;
            return (
              <button
                key={langName}
                onClick={() => handleSelectLanguage(langName)}
                className="text-[10px] px-2 py-0.5 rounded-full transition-all cursor-pointer"
                style={{
                  background: isSelected ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
                  color: isSelected ? '#fff' : 'var(--color-text-secondary)',
                  border: isSelected ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                {langName}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-1.5 mt-1">
        {/* Translate Latest Reply Button */}
        <button
          onClick={handleTranslateLatestReply}
          disabled={isLoading || isStreaming}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: 'var(--color-accent-subtle)',
            border: '1px solid var(--color-accent)',
            color: 'var(--color-accent)',
          }}
        >
          {isLoading ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>Translating...</span>
            </>
          ) : (
            <>
              <Sparkles size={13} />
              <span>Translate Latest Reply</span>
            </>
          )}
        </button>

        {/* Toggle Custom Input Text */}
        <button
          onClick={() => setShowCustomInput((prev) => !prev)}
          className="text-[11px] text-left px-1 py-0.5 transition-colors cursor-pointer"
          style={{ color: 'var(--color-text-tertiary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
        >
          {showCustomInput ? '− Hide custom text input' : '+ Translate custom English text'}
        </button>

        {/* Custom Text Area */}
        {showCustomInput && (
          <div className="flex flex-col gap-1.5 p-2 rounded-lg" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Enter English text to translate..."
              rows={3}
              className="w-full text-xs p-1.5 rounded resize-none outline-none"
              style={{
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
            />
            <button
              onClick={() => doTranslate(customText, selectedLang)}
              disabled={isLoading || !customText.trim()}
              className="flex items-center justify-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed self-end"
              style={{
                background: 'var(--color-accent)',
                color: '#fff',
              }}
            >
              <span>Translate Text</span>
              <ArrowRight size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Error Message Banner */}
      {errorMessage && (
        <div
          className="flex items-center justify-between text-[11px] p-2 rounded-lg"
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444',
          }}
        >
          <span className="truncate">{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="cursor-pointer ml-1">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Translated Result Card */}
      {translatedText && (
        <div
          className="flex flex-col rounded-lg p-3 gap-2 transition-all"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          {/* Result Card Header */}
          <div className="flex items-center justify-between pb-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                background: 'var(--color-accent-subtle)',
                color: 'var(--color-accent)',
              }}
            >
              {selectedLang} ({currentLangObj.native})
            </span>

            <div className="flex items-center gap-1">
              {/* Speak Button */}
              {'speechSynthesis' in window && (
                <button
                  onClick={handleSpeak}
                  title={isSpeaking ? 'Stop speaking' : `Read aloud in ${selectedLang}`}
                  className="p-1 rounded hover:bg-black/10 transition-colors cursor-pointer"
                  style={{ color: isSpeaking ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
                >
                  {isSpeaking ? <Square size={12} /> : <Volume2 size={12} />}
                </button>
              )}

              {/* Copy Button */}
              <button
                onClick={handleCopy}
                title="Copy translation"
                className="p-1 rounded hover:bg-black/10 transition-colors cursor-pointer"
                style={{ color: copied ? 'var(--color-success, #10b981)' : 'var(--color-text-tertiary)' }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>

              {/* Clear Button */}
              <button
                onClick={() => setTranslatedText('')}
                title="Clear translation"
                className="p-1 rounded hover:bg-black/10 transition-colors cursor-pointer"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Result Text */}
          <div
            className="text-xs leading-relaxed select-text whitespace-pre-wrap max-h-56 overflow-y-auto"
            style={{ color: 'var(--color-text)' }}
          >
            {translatedText}
          </div>
        </div>
      )}
    </section>
  );
}
