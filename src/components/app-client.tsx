'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Sparkles, Zap, Type, Scissors, Youtube, Upload, Film, X, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ClipInfo, ProcessingStep } from '@/components/process-progress';
import { ProcessProgress } from '@/components/process-progress';
import { ClipsResult } from '@/components/clips-result';
import { HealthCheckBar } from '@/components/health-check';

type AppPhase = 'idle' | 'processing' | 'done' | 'error';
type InputMode = 'url' | 'upload';

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];
const MAX_SIZE_MB = 100;

function validateYouTubeUrl(input: string): boolean {
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=/i,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\//i,
    /^https?:\/\/youtu\.be\//i,
    /^https?:\/\/(www\.)?youtube\.com\/embed\//i,
  ];
  return patterns.some(p => p.test(input.trim()));
}

export default function AppClient() {
  const [phase, setPhase] = useState<AppPhase>('idle');
  const [step, setStep] = useState<ProcessingStep>('uploading');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [transcript, setTranscript] = useState('');
  const [jobId, setJobId] = useState('');

  // Upload mode
  const [mode, setMode] = useState<InputMode>('url');
  const [url, setUrl] = useState('');
  const [urlOk, setUrlOk] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [fileError, setFileError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const clipsRef = useRef<ClipInfo[]>([]);

  const startProcessing = useCallback(async (fetchOptions: RequestInit) => {
    setPhase('processing');
    setStep('uploading');
    setMessage('Starting...');
    setProgress(5);
    setErrorMsg('');
    clipsRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch('/api/video/process', { ...fetchOptions, signal: controller.signal });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Processing failed' }));
        throw new Error(err.error || `Server error: ${resp.status}`);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.step === 'error') throw new Error(d.error || 'Processing failed');
            setStep(d.step);
            setMessage(d.message || '');
            if (d.progress !== undefined) setProgress(d.progress);
            if (d.transcript) setTranscript(d.transcript);
            if (d.clips) { setClips(d.clips); clipsRef.current = d.clips; }
            if (d.jobId) setJobId(d.jobId);
          } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
        }
      }

      // Parse remaining buffer
      if (clipsRef.current.length === 0 && buf) {
        for (const line of buf.split('\n').filter(l => l.startsWith('data: '))) {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.clips) { setClips(d.clips); clipsRef.current = d.clips; }
            if (d.jobId) setJobId(d.jobId);
          } catch {}
        }
      }

      setStep('done');
      setMessage('All done!');
      setProgress(100);
      setTimeout(() => setPhase('done'), 800);
    } catch (err: unknown) {
      const msg = err instanceof DOMException && err.name === 'AbortError'
        ? 'Cancelled.'
        : err instanceof Error ? err.message : 'Unknown error.';
      setErrorMsg(msg);
      setStep('error');
      setPhase('error');
    }
  }, []);

  const handleUrlSubmit = useCallback(() => {
    if (!validateYouTubeUrl(url)) { setFileError('Invalid YouTube URL'); return; }
    startProcessing({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtubeUrl: url.trim() }),
    });
  }, [url, startProcessing]);

  const handleFileSelect = useCallback((file: File) => {
    setFileError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFileError('Unsupported format. Use MP4, MOV, AVI, WebM, or MKV.');
      return;
    }
    const mb = file.size / (1024 * 1024);
    if (mb > MAX_SIZE_MB) {
      setFileError(`Too large (${mb.toFixed(1)}MB). Max ${MAX_SIZE_MB}MB.`);
      return;
    }
    setSelectedFile(file);
  }, []);

  const handleFileSubmit = useCallback(() => {
    if (!selectedFile) return;
    const fd = new FormData();
    fd.append('video', selectedFile);
    startProcessing({ method: 'POST', body: fd });
  }, [selectedFile, startProcessing]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('idle');
    setStep('uploading');
    setMessage('');
    setProgress(0);
    setErrorMsg('');
    setClips([]);
    setTranscript('');
    setJobId('');
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-amber-500/[0.03] blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] rounded-full bg-orange-500/[0.02] blur-[100px]" />
      </div>

      <main className="relative flex-1 flex flex-col items-center px-4 py-8 sm:py-12">
        <header className="text-center mb-8 sm:mb-12 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-300">AI-Powered Video Processing</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-red-400 bg-clip-text text-transparent">ClipAI</span>
          </h1>
          <p className="text-base sm:text-lg text-zinc-400 mt-3 leading-relaxed">
            Paste a YouTube link or upload your video — AI finds the best moments, creates clips, and adds professional subtitles.
          </p>
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

        <div className="flex-1 flex flex-col items-center justify-center w-full">
          {phase === 'idle' && (
            <div className="w-full max-w-2xl mx-auto">
              {/* Mode Toggle */}
              <div className="flex items-center justify-center mb-4">
                <div className="inline-flex items-center rounded-xl bg-zinc-900/60 border border-zinc-800 p-1">
                  <button
                    onClick={() => { setMode('url'); setFileError(''); }}
                    className={cn('flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all',
                      mode === 'url' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                    )}
                  >
                    <Youtube className="w-4 h-4" />
                    YouTube URL
                  </button>
                  <button
                    onClick={() => { setMode('upload'); setFileError(''); }}
                    className={cn('flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all',
                      mode === 'upload' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                    )}
                  >
                    <Upload className="w-4 h-4" />
                    Upload File
                  </button>
                </div>
              </div>

              {mode === 'url' ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                  <div className="p-6">
                    <div className="relative">
                      <Youtube className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-red-400" />
                      <Input
                        type="text"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={url}
                        onChange={(e) => {
                          setUrl(e.target.value);
                          setFileError('');
                          setUrlOk(e.target.value.trim() ? (validateYouTubeUrl(e.target.value) ? 'valid' : 'invalid') : 'idle');
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleUrlSubmit(); }}
                        className="pl-12 h-12 bg-zinc-800/50 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 rounded-xl text-sm focus:border-amber-500/50"
                      />
                      {urlOk === 'valid' && <CheckCircle2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-400" />}
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">Supports YouTube videos, Shorts. Max 10 minutes recommended.</p>
                  </div>
                  {fileError && <div className="px-6 pb-2"><p className="text-sm text-red-400">{fileError}</p></div>}
                  <div className="px-6 pb-6 flex justify-center">
                    <Button
                      onClick={handleUrlSubmit}
                      disabled={urlOk !== 'valid'}
                      className={cn('px-8 py-3 text-sm font-semibold rounded-xl transition-all',
                        urlOk === 'valid'
                          ? 'bg-gradient-to-r from-red-500 to-amber-500 hover:from-red-600 hover:to-amber-600 text-white shadow-lg shadow-red-500/20'
                          : 'bg-zinc-800 text-zinc-400 cursor-not-allowed'
                      )}
                    >
                      <Youtube className="w-5 h-5 mr-2" />
                      Process YouTube Video
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
                    className={cn('relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer group hover:border-amber-500/50',
                      dragging ? 'border-amber-400 bg-amber-500/10 scale-[1.02]' : 'border-zinc-700/50 bg-zinc-900/30 hover:bg-zinc-900/50'
                    )}
                  >
                    <div className="flex flex-col items-center justify-center py-12 px-6 gap-4">
                      {!selectedFile ? (
                        <>
                          <div className="relative">
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center border border-amber-500/20 group-hover:border-amber-500/40 transition-colors">
                              <Film className="w-10 h-10 text-amber-400" />
                            </div>
                            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
                              <Upload className="w-4 h-4 text-black" />
                            </div>
                          </div>
                          <div className="text-center">
                            <p className="text-lg font-medium text-zinc-100">Drop your video here</p>
                            <p className="text-sm text-zinc-400 mt-1">or <span className="text-amber-400 underline underline-offset-2">click to browse</span></p>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-zinc-500">
                            <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">MP4</span>
                            <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">MOV</span>
                            <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">AVI</span>
                            <span className="text-zinc-600">Max {MAX_SIZE_MB}MB</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-4 w-full px-4">
                          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center border border-amber-500/20 shrink-0">
                            <Film className="w-7 h-7 text-amber-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-100 truncate">{selectedFile.name}</p>
                            <p className="text-xs text-zinc-400 mt-0.5">{(selectedFile.size / (1024*1024)).toFixed(1)} MB</p>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setFileError(''); }} className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors">
                            <X className="w-4 h-4 text-zinc-400" />
                          </button>
                        </div>
                      )}
                    </div>
                    <input ref={inputRef} type="file" accept=".mp4,.mov,.avi,.webm,.mkv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }} />
                  </div>
                  {fileError && <p className="text-sm text-red-400 mt-2 text-center">{fileError}</p>}
                  {selectedFile && (
                    <div className="mt-6 flex justify-center">
                      <Button onClick={handleFileSubmit} className="px-8 py-6 text-base bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-semibold rounded-xl shadow-lg shadow-amber-500/20">
                        <Film className="w-5 h-5 mr-2" />Generate AI Clips
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {(phase === 'processing' || phase === 'error') && (
            <ProcessProgress currentStep={step} message={message} progress={progress} error={phase === 'error' ? errorMsg : undefined} />
          )}

          {phase === 'done' && (
            <ClipsResult clips={clips} transcript={transcript} jobId={jobId} onReset={reset} />
          )}
        </div>
      </main>

      <footer className="relative border-t border-zinc-800/50 mt-auto">
        <HealthCheckBar />
        <div className="px-4 py-4 text-center">
          <p className="text-xs text-zinc-500">Powered by Z.ai — AI Video Clipper & Subtitler</p>
        </div>
      </footer>
    </div>
  );
}
