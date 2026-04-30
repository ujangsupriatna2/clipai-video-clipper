'use client';

import React, { useRef, useState, useCallback } from 'react';
import { Play, Pause, Download, Clock, Type, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ClipInfo } from './process-progress';

interface ClipsResultProps {
  clips: ClipInfo[];
  transcript: string;
  jobId: string;
  onReset: () => void;
}

export function ClipsResult({ clips, transcript, jobId, onReset }: ClipsResultProps) {
  const [activeVideo, setActiveVideo] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [playingClips, setPlayingClips] = useState<Set<number>>(new Set());
  const videoRefs = useRef<Record<number, HTMLVideoElement | null>>({});

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const togglePlay = useCallback((index: number) => {
    const video = videoRefs.current[index];
    if (!video) return;

    if (playingClips.has(index)) {
      video.pause();
      setPlayingClips(prev => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    } else {
      video.play().catch(() => {});
      setPlayingClips(prev => new Set(prev).add(index));
    }
  }, [playingClips]);

  const handleVideoEnd = useCallback((index: number) => {
    setPlayingClips(prev => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }, []);

  const handleDownload = useCallback((clip: ClipInfo) => {
    const url = `/api/video/serve/${jobId}/${clip.filename}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = clip.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [jobId]);

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-3">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-sm text-emerald-300 font-medium">
            {clips.length} clip{clips.length !== 1 ? 's' : ''} generated
          </span>
        </div>
        <h2 className="text-2xl font-bold text-zinc-100">Your Clips Are Ready!</h2>
        <p className="text-sm text-zinc-400 mt-1">
          AI identified the most engaging moments and added subtitles
        </p>
      </div>

      {/* Clips Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {clips.map((clip, index) => {
          const clipUrl = `/api/video/serve/${jobId}/${clip.filename}`;
          const isPlaying = playingClips.has(index);
          const isActive = activeVideo === index;

          return (
            <div
              key={index}
              className={`rounded-2xl border overflow-hidden transition-all duration-300 ${
                isActive
                  ? 'border-amber-500/50 bg-zinc-900/80 shadow-lg shadow-amber-500/5'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
              }`}
              onClick={() => setActiveVideo(isActive ? null : index)}
            >
              {/* Video Player */}
              <div className="relative aspect-[9/16] bg-black group">
                <video
                  ref={(el) => { videoRefs.current[index] = el; }}
                  src={clipUrl}
                  className="w-full h-full object-cover"
                  onEnded={() => handleVideoEnd(index)}
                  playsInline
                  preload="metadata"
                  poster=""
                />
                {/* Play/Pause Overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePlay(index); }}
                    className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center hover:bg-white transition-colors shadow-lg"
                  >
                    {isPlaying ? (
                      <Pause className="w-6 h-6 text-black" />
                    ) : (
                      <Play className="w-6 h-6 text-black ml-0.5" />
                    )}
                  </button>
                </div>
                {/* Clip Badge */}
                <div className="absolute top-3 left-3">
                  <Badge className="bg-black/60 text-white border-0 backdrop-blur-sm text-xs px-2 py-0.5">
                    Clip {index + 1}
                  </Badge>
                </div>
                {/* Duration Badge */}
                <div className="absolute bottom-3 right-3">
                  <Badge className="bg-black/60 text-white border-0 backdrop-blur-sm text-xs px-2 py-0.5">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatTime(clip.duration)}
                  </Badge>
                </div>
              </div>

              {/* Info */}
              <div className="p-4">
                <h3 className="text-sm font-semibold text-zinc-100 line-clamp-1">
                  {clip.title}
                </h3>
                <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
                  {clip.description}
                </p>

                {/* Subtitle Preview */}
                <div className="mt-3 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                  <div className="flex items-start gap-2">
                    <Type className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed">
                      {clip.subtitle}
                    </p>
                  </div>
                </div>

                {/* Download Button */}
                <Button
                  onClick={(e) => { e.stopPropagation(); handleDownload(clip); }}
                  className="w-full mt-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs h-9 rounded-lg border border-zinc-700/50"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Download Clip
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Transcript Toggle */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-zinc-800/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Type className="w-5 h-5 text-amber-400" />
            <div className="text-left">
              <h3 className="text-sm font-semibold text-zinc-100">Full Transcript</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Complete speech-to-text transcription of your video
              </p>
            </div>
          </div>
          {showTranscript ? (
            <ChevronUp className="w-5 h-5 text-zinc-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-zinc-400" />
          )}
        </button>

        {showTranscript && (
          <div className="px-6 pb-5">
            <div className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-700/30 max-h-64 overflow-y-auto">
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {transcript}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Reset Button */}
      <div className="flex justify-center pb-4">
        <Button
          onClick={onReset}
          variant="outline"
          className="px-6 py-2.5 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 rounded-xl"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Process Another Video
        </Button>
      </div>
    </div>
  );
}
