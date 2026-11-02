import { useEffect, useRef } from 'react';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface VoiceWaveVisualizerProps {
  state: VoiceState;
  audioLevel?: number; // 0 to 1
  className?: string;
}

export function VoiceWaveVisualizer({
  state,
  audioLevel = 0,
  className = '',
}: VoiceWaveVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const phaseRef = useRef<number>(0);
  const smoothedLevelRef = useRef<number>(0.08);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    const render = () => {
      if (!isRunning) return;

      const width = canvas.width;
      const height = canvas.height;
      if (width === 0 || height === 0) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Smooth the incoming audioLevel
      const targetLevel = state === 'listening' 
        ? Math.max(0.12, audioLevel) 
        : state === 'speaking' 
        ? Math.max(0.2, audioLevel || 0.45 + Math.sin(phaseRef.current * 2) * 0.25)
        : state === 'thinking'
        ? 0.35 + Math.sin(phaseRef.current * 3) * 0.15
        : 0.08;

      smoothedLevelRef.current += (targetLevel - smoothedLevelRef.current) * 0.12;
      const amp = smoothedLevelRef.current;

      // Clear with background transparent
      ctx.clearRect(0, 0, width, height);

      // Phase progression speed depends on state
      const speed = state === 'listening' ? 0.07 : state === 'speaking' ? 0.05 : state === 'thinking' ? 0.08 : 0.025;
      phaseRef.current += speed;
      const phase = phaseRef.current;

      const midY = height / 2;

      // Color themes per state
      type WaveLayer = {
        freq: number;
        ampMul: number;
        phaseOffset: number;
        color: string;
        fillColor?: string;
        lineWidth: number;
        shadowBlur: number;
        shadowColor: string;
      };

      let layers: WaveLayer[] = [];

      if (state === 'listening') {
        // Vibrant neon cyan / electric blue reactive wave
        layers = [
          {
            freq: 0.012,
            ampMul: 1.2,
            phaseOffset: 0,
            color: 'rgba(34, 211, 238, 0.95)',
            fillColor: 'rgba(34, 211, 238, 0.08)',
            lineWidth: 3,
            shadowBlur: 24,
            shadowColor: 'rgba(34, 211, 238, 0.75)',
          },
          {
            freq: 0.018,
            ampMul: 0.85,
            phaseOffset: 1.2,
            color: 'rgba(56, 189, 248, 0.7)',
            lineWidth: 2,
            shadowBlur: 16,
            shadowColor: 'rgba(56, 189, 248, 0.5)',
          },
          {
            freq: 0.026,
            ampMul: 0.55,
            phaseOffset: 2.5,
            color: 'rgba(99, 102, 241, 0.55)',
            lineWidth: 1.5,
            shadowBlur: 10,
            shadowColor: 'rgba(99, 102, 241, 0.4)',
          },
        ];
      } else if (state === 'speaking') {
        // Glowing purple / cyan harmonic voice wave
        layers = [
          {
            freq: 0.01,
            ampMul: 1.3,
            phaseOffset: 0,
            color: 'rgba(192, 132, 252, 0.95)',
            fillColor: 'rgba(192, 132, 252, 0.09)',
            lineWidth: 3,
            shadowBlur: 26,
            shadowColor: 'rgba(192, 132, 252, 0.8)',
          },
          {
            freq: 0.016,
            ampMul: 0.9,
            phaseOffset: 1.8,
            color: 'rgba(129, 140, 248, 0.75)',
            lineWidth: 2,
            shadowBlur: 18,
            shadowColor: 'rgba(129, 140, 248, 0.6)',
          },
          {
            freq: 0.024,
            ampMul: 0.6,
            phaseOffset: 3.1,
            color: 'rgba(34, 211, 238, 0.6)',
            lineWidth: 1.5,
            shadowBlur: 12,
            shadowColor: 'rgba(34, 211, 238, 0.4)',
          },
        ];
      } else if (state === 'thinking') {
        // Amber / violet pulsing orbital flow
        layers = [
          {
            freq: 0.014,
            ampMul: 0.9,
            phaseOffset: 0,
            color: 'rgba(245, 158, 11, 0.9)',
            fillColor: 'rgba(245, 158, 11, 0.06)',
            lineWidth: 2.5,
            shadowBlur: 20,
            shadowColor: 'rgba(245, 158, 11, 0.7)',
          },
          {
            freq: 0.02,
            ampMul: 0.7,
            phaseOffset: 2.0,
            color: 'rgba(168, 85, 247, 0.75)',
            lineWidth: 2,
            shadowBlur: 16,
            shadowColor: 'rgba(168, 85, 247, 0.5)',
          },
        ];
      } else {
        // Idle: serene, soft breathing cyan wave
        layers = [
          {
            freq: 0.008,
            ampMul: 0.35,
            phaseOffset: 0,
            color: 'rgba(34, 211, 238, 0.6)',
            fillColor: 'rgba(34, 211, 238, 0.03)',
            lineWidth: 2,
            shadowBlur: 12,
            shadowColor: 'rgba(34, 211, 238, 0.35)',
          },
          {
            freq: 0.014,
            ampMul: 0.22,
            phaseOffset: 1.5,
            color: 'rgba(56, 189, 248, 0.35)',
            lineWidth: 1.5,
            shadowBlur: 8,
            shadowColor: 'rgba(56, 189, 248, 0.2)',
          },
        ];
      }

      // Draw each wave layer
      for (const layer of layers) {
        ctx.save();
        ctx.shadowBlur = layer.shadowBlur;
        ctx.shadowColor = layer.shadowColor;
        ctx.strokeStyle = layer.color;
        ctx.lineWidth = layer.lineWidth;
        ctx.beginPath();

        const maxPeak = (height * 0.38) * amp * layer.ampMul;

        // Draw curved wave from x = 0 to width
        for (let x = 0; x <= width; x += 3) {
          // Windowing envelope function (smooth fade at left & right edges)
          const normX = x / width;
          const envelope = Math.sin(normX * Math.PI); // 0 at edges, 1 in center

          // Multi-harmonic formula for organic sound ripple
          const y =
            midY +
            Math.sin(x * layer.freq + phase + layer.phaseOffset) * maxPeak * envelope +
            Math.cos(x * (layer.freq * 0.6) - phase * 0.7) * (maxPeak * 0.35) * envelope;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();

        // Optional fill under primary wave
        if (layer.fillColor) {
          ctx.lineTo(width, height);
          ctx.lineTo(0, height);
          ctx.closePath();
          ctx.fillStyle = layer.fillColor;
          ctx.fill();
        }

        ctx.restore();
      }

      // Draw glowing central energy pulse
      const centerGlow = ctx.createRadialGradient(
        width / 2,
        midY,
        0,
        width / 2,
        midY,
        Math.max(60, 180 * amp),
      );
      const glowAlpha = state === 'listening' ? 0.18 : state === 'speaking' ? 0.2 : state === 'thinking' ? 0.14 : 0.05;
      const glowRgb = state === 'speaking' ? '192, 132, 252' : state === 'thinking' ? '245, 158, 11' : '34, 211, 238';
      centerGlow.addColorStop(0, `rgba(${glowRgb}, ${glowAlpha})`);
      centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = centerGlow;
      ctx.fillRect(0, 0, width, height);

      animFrameRef.current = requestAnimationFrame(render);
    };

    // Resize handling with devicePixelRatio
    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [state, audioLevel]);

  return (
    <div className={`relative w-full flex items-center justify-center overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ filter: 'drop-shadow(0 0 20px rgba(34, 211, 238, 0.15))' }}
      />
    </div>
  );
}
