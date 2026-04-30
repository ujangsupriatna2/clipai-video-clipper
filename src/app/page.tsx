'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Sparkles, Zap, Type, Scissors } from 'lucide-react';
import { VideoUploadZone } from '@/components/video-upload-zone';
import { ProcessProgress, type ProcessingStep, type ClipInfo } from '@/components/process-progress';
import { ClipsResult } from '@/components/clips-result';

type AppPhase = 'idle' | 'processing' | 'done' | 'error';

export default function Home() {
  const [phase, setPhase] = useState<AppPhase>('idle');
  const [currentStep, setCurrentStep] = useState<ProcessingStep>('uploading');
  const [statusMessage, setStatusMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [transcript, setTranscript] = useState('');
  const [jobId, setJobId] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const latestClipsRef = useRef<ClipInfo[]>([]);

  const processVideo = useCallback(async (file: File) => {
    setPhase('processing');
    setCurrentStep('uploading');
    setStatusMessage('Uploading your video...');
    setProgress(5);
    setErrorMessage('');
    latestClipsRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append('video', file);

      const response = await fetch('/api/video/process', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Processing failed' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.step === 'error') {
              throw new Error(data.error || 'Processing failed');
            }

            setCurrentStep(data.step);
            setStatusMessage(data.message || '');
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.transcript) setTranscript(data.transcript);
            if (data.clips) {
              setClips(data.clips);
              latestClipsRef.current = data.clips;
            }
            if (data.jobId) setJobId(data.jobId);
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      // Check remaining buffer
      if (latestClipsRef.current.length === 0 && buffer) {
        const remaining = buffer.split('\n').filter(l => l.startsWith('data: '));
        for (const line of remaining) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.clips) {
              setClips(data.clips);
              latestClipsRef.current = data.clips;
            }
            if (data.jobId) setJobId(data.jobId);
          } catch {}
        }
      }

      setCurrentStep('done');
      setStatusMessage('All done! Your clips are ready.');
      setProgress(100);

      setTimeout(() => {
        setPhase('done');
      }, 800);

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMessage('Processing was cancelled.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
      setCurrentStep('error');
      setPhase('error');
    }
  }, []);

  const processYouTubeUrl = useCallback(async (url: string) => {
    setPhase('processing');
    setCurrentStep('uploading');
    setStatusMessage('Connecting to YouTube...');
    setProgress(3);
    setErrorMessage('');
    latestClipsRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/video/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl: url }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Processing failed' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.step === 'error') {
              throw new Error(data.error || 'Processing failed');
            }

            setCurrentStep(data.step);
            setStatusMessage(data.message || '');
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.transcript) setTranscript(data.transcript);
            if (data.clips) {
              setClips(data.clips);
              latestClipsRef.current = data.clips;
            }
            if (data.jobId) setJobId(data.jobId);
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (latestClipsRef.current.length === 0 && buffer) {
        const remaining = buffer.split('\n').filter(l => l.startsWith('data: '));
        for (const line of remaining) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.clips) {
              setClips(data.clips);
              latestClipsRef.current = data.clips;
            }
            if (data.jobId) setJobId(data.jobId);
          } catch {}
        }
      }

      setCurrentStep('done');
      setStatusMessage('All done! Your clips are ready.');
      setProgress(100);

      setTimeout(() => {
        setPhase('done');
      }, 800);

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMessage('Processing was cancelled.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
      setCurrentStep('error');
      setPhase('error');
    }
  }, []);

  const handleReset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setPhase('idle');
    setCurrentStep('uploading');
    setStatusMessage('');
    setProgress(0);
    setErrorMessage('');
    setClips([]);
    setTranscript('');
    setJobId('');
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-amber-500/[0.03] blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] rounded-full bg-orange-500/[0.02] blur-[100px]" />
      </div>

      {/* Main Content */}
      <main className="relative flex-1 flex flex-col items-center px-4 py-8 sm:py-12">
        {/* Header */}
        <header className="text-center mb-8 sm:mb-12 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-300">AI-Powered Video Processing</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-red-400 bg-clip-text text-transparent">
              ClipAI
            </span>
          </h1>
          <p className="text-base sm:text-lg text-zinc-400 mt-3 leading-relaxed">
            Paste a YouTube link or upload your video — AI finds the best moments,
            creates clips, and adds professional subtitles.
          </p>

          {/* Feature badges */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs text-zinc-300">Smart Detection</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <Scissors className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-zinc-300">Auto Clipping</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <Type className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs text-zinc-300">Auto Subtitles</span>
            </div>
          </div>
        </header>

        {/* Dynamic Content Area */}
        <div className="flex-1 flex flex-col items-center justify-center w-full">
          {phase === 'idle' && (
            <VideoUploadZone
              onFileSelect={processVideo}
              onUrlSubmit={processYouTubeUrl}
            />
          )}

          {phase === 'processing' && (
            <ProcessProgress
              currentStep={currentStep}
              message={statusMessage}
              progress={progress}
            />
          )}

          {phase === 'error' && (
            <ProcessProgress
              currentStep="error"
              message={statusMessage}
              error={errorMessage}
            />
          )}

          {phase === 'done' && (
            <ClipsResult
              clips={clips}
              transcript={transcript}
              jobId={jobId}
              onReset={handleReset}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative border-t border-zinc-800/50 mt-auto">
        <div className="px-4 py-4 text-center">
          <p className="text-xs text-zinc-500">
            Powered by Z.ai — AI Video Clipper & Subtitler
          </p>
        </div>
      </footer>
    </div>
  );
}
