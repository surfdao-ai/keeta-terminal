'use client';

import { useEffect, useRef, useState } from 'react';
import { csrfHeader } from '@/lib/client/api';

interface VoiceInputProps {
  disabled: boolean;
  apiKey: string;
  /** The transcript lands here (appended, so it can be edited before sending). */
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}

/**
 * Voice input for the chat composer: hold a recording while speaking, send it
 * to /api/chat/transcribe (Venice speech-to-text, the user's own API key),
 * and the transcript lands in the input box. The button doubles as the
 * mic-permission request, so nothing starts until the user taps it.
 */
export default function VoiceInput({ disabled, apiKey, onTranscript, onError }: VoiceInputProps) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<number>(0);

  // Mic level meter while recording.
  useEffect(() => {
    if (!recording || !streamRef.current) return;
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let ctx: AudioContext | null = null;
    let stopLevel: (() => void) | null = null;
    try {
      ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(streamRef.current).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        setLevel(data.reduce((a, b) => a + b, 0) / data.length / 255);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      stopLevel = () => {
        cancelAnimationFrame(rafRef.current);
        void ctx?.close();
      };
    } catch {
      /* the meter is cosmetic — recording still works */
    }
    return () => stopLevel?.();
  }, [recording]);

  const b64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result ?? '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(blob);
    });

  async function start() {
    if (disabled) return;
    if (!apiKey) {
      onError('No Venice API key — open "Model setup" and add one to use voice input.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('This browser cannot record audio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => void finish();
      rec.start(250);
      setRecording(true);
      // A runaway timer must never leave the mic on: 60s cap.
      timerRef.current = window.setTimeout(() => stop(), 60_000);
    } catch (e) {
      const name = (e as Error)?.name;
      onError(
        name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it for this site and try again.'
          : name === 'NotFoundError'
            ? 'No microphone found.'
            : 'Could not start the microphone.',
      );
    }
  }

  function stop() {
    window.clearTimeout(timerRef.current);
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    setRecording(false);
  }

  async function finish() {
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunksRef.current, { type: recRef.current?.mimeType || 'audio/webm' });
    chunksRef.current = [];
    if (blob.size === 0) return;

    setTranscribing(true);
    try {
      const audioBase64 = await b64(blob);
      const r = await fetch('/api/chat/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...csrfHeader() },
        body: JSON.stringify({ audioBase64, apiKey }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j.error ?? `Transcription failed (${r.status})`));
      if (j.text) onTranscript(String(j.text));
      else onError('Could not hear anything. Try speaking a little closer to the mic.');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  }

  const busy = recording || transcribing;
  return (
    <button
      type="button"
      onClick={recording ? stop : () => void start()}
      disabled={disabled && !recording}
      aria-label={recording ? 'stop recording' : 'voice input'}
      title={
        recording
          ? 'Stop recording'
          : transcribing
            ? 'Transcribing…'
            : 'Hold to talk — your words land in the box'
      }
      className={`relative shrink-0 h-9 w-9 rounded-full flex items-center justify-center transition ${
        recording
          ? 'bg-red-600/90 hover:bg-red-500 text-white'
          : transcribing
            ? 'bg-zinc-800 text-zinc-400'
            : 'bg-zinc-800/70 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30'
      }`}
    >
      {transcribing ? (
        <span className="h-4 w-4 rounded-full border-2 border-zinc-500 border-t-transparent animate-spin" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
          <path d="M12 18v4" />
        </svg>
      )}
      {recording && (
        // A small level pip under the mic: grows and brightens with input.
        <span
          className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-white"
          style={{ transform: `translateX(-50%) scale(${1 + level * 2.5})`, opacity: 0.4 + level * 0.6 }}
          aria-hidden="true"
        />
      )}
    </button>
  );
}
