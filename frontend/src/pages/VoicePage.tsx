import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Mic,
  MicOff,
  Square,
  Sparkles,
  Zap,
  Activity,
  Cpu,
  RefreshCw,
  MessageSquare,
  Volume2,
  VolumeX,
  History,
  CheckCircle2,
  Sliders,
} from 'lucide-react';
import { VoiceWaveVisualizer, type VoiceState } from '../components/Voice/VoiceWaveVisualizer';
import { useAppStore } from '../lib/store';
import { streamChat } from '../lib/sse';
import { synthesizeSpeech, getBase } from '../lib/api';

interface VoiceTaskHistoryItem {
  id: string;
  userPrompt: string;
  aiReply: string;
  timestamp: number;
  model: string;
  durationMs?: number;
}

export function VoicePage() {
  const navigate = useNavigate();
  const selectedModel = useAppStore((s) => s.selectedModel);
  const activeId = useAppStore((s) => s.activeId);
  const addMessage = useAppStore((s) => s.addMessage);
  const createConversation = useAppStore((s) => s.createConversation);
  const liveEnergy = useAppStore((s) => s.liveEnergy);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [taskPhase, setTaskPhase] = useState('');
  const [audioLevel, setAudioLevel] = useState(0.08);
  const [continuousMode, setContinuousMode] = useState(true);
  const [audioMuted, setAudioMuted] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<VoiceTaskHistoryItem[]>([]);

  // Audio analysis refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Setup Web Audio Analyser for live mic visualization
  const setupAudioAnalyser = useCallback(async (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // Compute average frequency power
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const normalized = Math.min(1, Math.max(0.05, (avg / 128) * 1.8));
        setAudioLevel(normalized);

        animFrameRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch {
      // AudioContext failure: visualizer falls back to procedural simulation
    }
  }, []);

  const stopAudioAnalyser = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0.08);
  }, []);

  // Stop any current TTS speech
  const stopSpeech = useCallback(() => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      currentUtteranceRef.current = null;
    }
  }, []);

  // Play spoken reply
  const speakReply = useCallback(
    async (text: string, onFinish?: () => void) => {
      if (audioMuted) {
        onFinish?.();
        return;
      }

      setVoiceState('speaking');
      setTaskPhase('Synthesizing speech response...');

      // First try server-side TTS endpoint if available
      try {
        const base = getBase();
        const res = await fetch(`${base}/v1/speech/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.slice(0, 800) }),
        });

        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          ttsAudioRef.current = audio;

          audio.onended = () => {
            URL.revokeObjectURL(url);
            ttsAudioRef.current = null;
            onFinish?.();
          };

          audio.onerror = () => {
            URL.revokeObjectURL(url);
            ttsAudioRef.current = null;
            fallbackWebSpeech(text, onFinish);
          };

          await audio.play();
          return;
        }
      } catch {
        // Fall back to browser Web Speech API
      }

      fallbackWebSpeech(text, onFinish);
    },
    [audioMuted],
  );

  const fallbackWebSpeech = (text: string, onFinish?: () => void) => {
    if (!('speechSynthesis' in window)) {
      onFinish?.();
      return;
    }

    window.speechSynthesis.cancel();

    // Clean markdown symbols for cleaner speech
    const cleanText = text
      .replace(/[#*_`~>-]/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/\n+/g, '. ')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    // Pick modern natural sounding voice if available
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Samantha')),
    );
    if (naturalVoice) utterance.voice = naturalVoice;

    utterance.onend = () => {
      currentUtteranceRef.current = null;
      onFinish?.();
    };

    utterance.onerror = () => {
      currentUtteranceRef.current = null;
      onFinish?.();
    };

    currentUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  // Dispatch prompt to backend LLM and process task
  const executeVoiceTask = useCallback(
    async (promptText: string) => {
      if (!promptText.trim()) {
        setVoiceState('idle');
        return;
      }

      setVoiceState('thinking');
      setTaskPhase(`Executing background task with ${selectedModel}...`);
      setAiResponse('');

      const startTime = Date.now();
      const convId = activeId || createConversation(selectedModel);

      // Record to store for unified history
      addMessage(convId, {
        id: crypto.randomUUID(),
        role: 'user',
        content: promptText,
        timestamp: Date.now(),
      });

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let accumulated = '';

      try {
        const stream = streamChat(
          {
            model: selectedModel,
            messages: [{ role: 'user', content: promptText }],
            stream: true,
          },
          controller.signal,
        );

        for await (const event of stream) {
          if (event.event === 'agent_turn_start') {
            setTaskPhase('Reasoning in background...');
          } else if (event.event === 'tool_call_start') {
            try {
              const data = JSON.parse(event.data);
              setTaskPhase(`Running system tool: ${data.tool}...`);
            } catch {}
          } else if (event.event === 'inference_start') {
            setTaskPhase('Generating response...');
          }

          if (event.data) {
            try {
              const parsed = JSON.parse(event.data);
              const chunk = parsed.choices?.[0]?.delta?.content || parsed.message?.content || '';
              if (chunk) {
                accumulated += chunk;
                setAiResponse(accumulated);
              }
            } catch {}
          }
        }

        const reply = accumulated.trim() || 'Task completed successfully.';
        setAiResponse(reply);

        // Record assistant response to global store
        addMessage(convId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply,
          timestamp: Date.now(),
        });

        // Add to local voice history
        const duration = Date.now() - startTime;
        setHistory((prev) => [
          {
            id: crypto.randomUUID(),
            userPrompt: promptText,
            aiReply: reply,
            timestamp: Date.now(),
            model: selectedModel,
            durationMs: duration,
          },
          ...prev.slice(0, 19),
        ]);

        // Speak the answer aloud
        speakReply(reply, () => {
          setVoiceState('idle');
          setTaskPhase('');
          // Continuous conversational loop
          if (continuousMode) {
            setTimeout(() => {
              startListening();
            }, 600);
          }
        });
      } catch (err: any) {
        if (err.name === 'AbortError') {
          setVoiceState('idle');
          setTaskPhase('Task cancelled');
          return;
        }
        const errorMsg = 'Could not complete task: ' + (err.message || 'Server error');
        setAiResponse(errorMsg);
        setVoiceState('idle');
        setTaskPhase('');
      }
    },
    [selectedModel, activeId, createConversation, addMessage, continuousMode, speakReply],
  );

  // Start listening to microphone
  const startListening = useCallback(async () => {
    stopSpeech();
    setTranscript('');
    setInterimText('');
    setAiResponse('');
    setVoiceState('listening');
    setTaskPhase('Listening for your command...');

    // Request microphone stream for visualizer audio analyser
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
        setupAudioAnalyser(stream);
      }
    } catch {
      // Permission denied or not available; fallback to procedural wave
    }

    // Initialize Web Speech Recognition
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        let finalSpeech = '';

        recognition.onresult = (e: any) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) {
              finalSpeech += e.results[i][0].transcript;
            } else {
              interim += e.results[i][0].transcript;
            }
          }
          setTranscript(finalSpeech);
          setInterimText(interim);
        };

        recognition.onerror = () => {
          stopAudioAnalyser();
          setVoiceState('idle');
          setTaskPhase('');
        };

        recognition.onend = () => {
          stopAudioAnalyser();
          const prompt = (finalSpeech || interimText).trim();
          if (prompt) {
            executeVoiceTask(prompt);
          } else {
            setVoiceState('idle');
            setTaskPhase('');
          }
        };

        recognition.start();
      } catch {
        setVoiceState('idle');
        stopAudioAnalyser();
      }
    } else {
      // Browser does not support Web Speech Recognition
      setTaskPhase('Speech recognition not supported in this browser. Please use Chrome, Edge, or Safari.');
      setVoiceState('idle');
      stopAudioAnalyser();
    }
  }, [setupAudioAnalyser, stopAudioAnalyser, stopSpeech, executeVoiceTask, interimText]);

  // Stop listening / finish speech input
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    stopAudioAnalyser();
  }, [stopAudioAnalyser]);

  // Cancel any ongoing task or speech
  const handleInterrupt = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopSpeech();
    stopListening();
    setVoiceState('idle');
    setTaskPhase('');
  }, [stopSpeech, stopListening]);

  // Spacebar hotkey to toggle voice
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (voiceState === 'idle') {
          startListening();
        } else if (voiceState === 'listening') {
          stopListening();
        } else {
          handleInterrupt();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [voiceState, startListening, stopListening, handleInterrupt]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeech();
      stopAudioAnalyser();
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [stopSpeech, stopAudioAnalyser]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative select-none" style={{ background: 'var(--color-bg)' }}>
      {/* Top HUD Status Bar */}
      <div
        className="flex items-center justify-between px-6 py-3 shrink-0 border-b z-20 backdrop-blur-md"
        style={{
          borderColor: 'var(--color-border)',
          background: 'color-mix(in srgb, var(--color-bg) 85%, transparent)',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-mono"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-accent)',
            }}
          >
            <Cpu size={14} />
            <span>{selectedModel}</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-0.5 rounded-full"
            style={{
              background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
              color: 'var(--color-success)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Background Agent Ready</span>
          </div>
        </div>

        {/* Telemetry & Quick Controls */}
        <div className="flex items-center gap-2">
          {liveEnergy && (
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-mono"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-accent-amber)',
              }}
            >
              <Zap size={13} />
              <span>{liveEnergy.power_w.toFixed(1)}W</span>
            </div>
          )}

          {/* Continuous Loop Toggle */}
          <button
            onClick={() => setContinuousMode((c) => !c)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer"
            style={{
              borderColor: continuousMode ? 'var(--color-accent)' : 'var(--color-border)',
              background: continuousMode
                ? 'color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-secondary))'
                : 'var(--color-bg-secondary)',
              color: continuousMode ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            }}
            title={continuousMode ? 'Continuous conversational loop active' : 'Push-to-talk mode'}
          >
            <RefreshCw size={13} className={continuousMode ? 'animate-spin-slow' : ''} />
            <span className="hidden sm:inline">Hands-Free</span>
          </button>

          {/* Audio Mute Toggle */}
          <button
            onClick={() => setAudioMuted((m) => !m)}
            className="p-1.5 rounded-lg border transition-colors cursor-pointer"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: audioMuted ? 'var(--color-error)' : 'var(--color-text-secondary)',
            }}
            title={audioMuted ? 'Voice output muted' : 'Voice output active'}
          >
            {audioMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>

          {/* History Drawer Toggle */}
          <button
            onClick={() => setShowHistory((h) => !h)}
            className="p-1.5 rounded-lg border transition-colors cursor-pointer"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-secondary)',
            }}
            title="Voice Task History"
          >
            <History size={15} />
          </button>

          {/* Jump to Chat View */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-secondary)',
            }}
            title="Open standard text chat"
          >
            <MessageSquare size={13} />
            <span className="hidden sm:inline">Chat</span>
          </button>
        </div>
      </div>

      {/* Main Center Stage with Audio Wave Visualizer */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10 min-h-0">
        {/* Orbital Futuristic Reticle Background */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40"
          style={{ transform: 'scale(1.15)' }}
        >
          <div
            className="w-96 h-96 rounded-full border border-dashed transition-all duration-700"
            style={{
              borderColor:
                voiceState === 'listening'
                  ? 'var(--color-accent)'
                  : voiceState === 'speaking'
                  ? 'var(--color-accent-purple)'
                  : voiceState === 'thinking'
                  ? 'var(--color-accent-amber)'
                  : 'var(--color-border)',
              animation: voiceState !== 'idle' ? 'spin 24s linear infinite' : 'none',
            }}
          />
        </div>

        {/* Status Pill Badge */}
        <div className="mb-6 z-20 flex flex-col items-center gap-2">
          <div
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium tracking-wide border shadow-md transition-all duration-300"
            style={{
              borderColor:
                voiceState === 'listening'
                  ? 'var(--color-accent)'
                  : voiceState === 'speaking'
                  ? 'var(--color-accent-purple)'
                  : voiceState === 'thinking'
                  ? 'var(--color-accent-amber)'
                  : 'var(--color-border)',
              background:
                voiceState === 'listening'
                  ? 'color-mix(in srgb, var(--color-accent) 15%, var(--color-bg-secondary))'
                  : voiceState === 'speaking'
                  ? 'color-mix(in srgb, var(--color-accent-purple) 15%, var(--color-bg-secondary))'
                  : voiceState === 'thinking'
                  ? 'color-mix(in srgb, var(--color-accent-amber) 15%, var(--color-bg-secondary))'
                  : 'var(--color-bg-secondary)',
              color:
                voiceState === 'listening'
                  ? 'var(--color-accent)'
                  : voiceState === 'speaking'
                  ? 'var(--color-accent-purple)'
                  : voiceState === 'thinking'
                  ? 'var(--color-accent-amber)'
                  : 'var(--color-text-secondary)',
            }}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                voiceState !== 'idle' ? 'animate-ping' : ''
              }`}
              style={{
                background:
                  voiceState === 'listening'
                    ? 'var(--color-accent)'
                    : voiceState === 'speaking'
                    ? 'var(--color-accent-purple)'
                    : voiceState === 'thinking'
                    ? 'var(--color-accent-amber)'
                    : 'var(--color-text-tertiary)',
              }}
            />
            <span className="uppercase text-[11px] font-bold">
              {voiceState === 'listening'
                ? 'Listening to Voice...'
                : voiceState === 'thinking'
                ? 'Background System Working...'
                : voiceState === 'speaking'
                ? 'OpenJarvis Speaking...'
                : 'Jarvis Ready'}
            </span>
          </div>

          {taskPhase && (
            <span className="text-xs text-muted-foreground animate-fade-in font-mono">
              {taskPhase}
            </span>
          )}
        </div>

        {/* Grand Wave Type Canvas Visualizer */}
        <div className="w-full max-w-2xl h-56 relative flex items-center justify-center my-4 z-20">
          <VoiceWaveVisualizer
            state={voiceState}
            audioLevel={audioLevel}
            className="h-full rounded-2xl"
          />
        </div>

        {/* Live Spoken Speech Subtitles / Assistant Response Typography */}
        <div className="max-w-2xl w-full text-center px-4 min-h-[90px] flex flex-col items-center justify-center z-20">
          {voiceState === 'listening' && (
            <p className="text-xl md:text-2xl font-medium tracking-tight animate-fade-in" style={{ color: 'var(--color-text)' }}>
              {transcript || interimText ? (
                <>
                  <span>{transcript}</span>
                  <span className="opacity-60">{interimText ? ` ${interimText}` : ''}</span>
                </>
              ) : (
                <span className="opacity-40 italic">Speak now, Jarvis is listening...</span>
              )}
            </p>
          )}

          {voiceState === 'thinking' && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-lg font-medium opacity-80" style={{ color: 'var(--color-text)' }}>
                "{transcript || 'Processing prompt'}"
              </p>
              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <Sparkles size={14} className="text-amber-400 animate-spin" />
                <span>Running background reasoning and agent tools...</span>
              </div>
            </div>
          )}

          {voiceState === 'speaking' && (
            <div className="max-h-40 overflow-y-auto px-4 py-2 rounded-xl text-left border shadow-inner"
              style={{
                borderColor: 'var(--color-border)',
                background: 'color-mix(in srgb, var(--color-bg-secondary) 80%, transparent)',
              }}
            >
              <p className="text-sm md:text-base leading-relaxed" style={{ color: 'var(--color-text)' }}>
                {aiResponse}
              </p>
            </div>
          )}

          {voiceState === 'idle' && (
            <p className="text-sm text-muted-foreground max-w-md">
              Tap the microphone or press <kbd className="px-1.5 py-0.5 rounded border font-mono text-[11px] bg-muted">Space</kbd> to start speaking. Jarvis will execute tasks in the background.
            </p>
          )}
        </div>

        {/* Big Center Action Trigger */}
        <div className="mt-8 z-30 flex items-center gap-4">
          {voiceState === 'idle' ? (
            <button
              onClick={startListening}
              className="group relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 cursor-pointer shadow-xl hover:scale-105 active:scale-95"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-on-accent)',
                boxShadow: '0 0 35px var(--color-accent-glow)',
              }}
              title="Start listening (Spacebar)"
            >
              <Mic size={32} className="transition-transform group-hover:scale-110" />
            </button>
          ) : voiceState === 'listening' ? (
            <button
              onClick={stopListening}
              className="group relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 cursor-pointer shadow-xl hover:scale-105 active:scale-95 animate-pulse"
              style={{
                background: 'var(--color-error)',
                color: '#fff',
                boxShadow: '0 0 35px rgba(239, 68, 68, 0.4)',
              }}
              title="Stop listening and send"
            >
              <Square size={26} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleInterrupt}
              className="group relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 cursor-pointer shadow-xl hover:scale-105 active:scale-95"
              style={{
                background: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border)',
                borderWidth: 2,
                color: 'var(--color-text-secondary)',
              }}
              title="Interrupt and stop (Spacebar)"
            >
              <Square size={24} />
            </button>
          )}
        </div>
      </div>

      {/* Slide-out Task History Drawer */}
      {showHistory && (
        <div
          className="absolute right-0 top-14 bottom-0 w-80 md:w-96 border-l z-30 shadow-2xl flex flex-col backdrop-blur-xl animate-in slide-in-from-right duration-200"
          style={{
            borderColor: 'var(--color-border)',
            background: 'color-mix(in srgb, var(--color-bg-secondary) 95%, transparent)',
          }}
        >
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2">
              <History size={16} style={{ color: 'var(--color-accent)' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Voice Task Activity
              </h3>
            </div>
            <button
              onClick={() => setShowHistory(false)}
              className="text-xs opacity-60 hover:opacity-100 cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {history.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No voice tasks executed yet. Start talking to see your background tasks log.
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl border text-xs space-y-1.5"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: 'var(--color-bg)',
                  }}
                >
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-mono text-cyan-500">{item.model}</span>
                    <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="font-semibold text-foreground">"{item.userPrompt}"</p>
                  <p className="text-muted-foreground line-clamp-3">{item.aiReply}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
