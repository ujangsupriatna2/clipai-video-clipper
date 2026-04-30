'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
  Upload,
  Volume2,
  Brain,
  Scissors,
  Subtitles,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

export type ProcessingStep =
  | 'uploading'
  | 'extracting'
  | 'transcribing'
  | 'analyzing'
  | 'generating'
  | 'done'
  | 'error';

export interface ProcessingEvent {
  step: ProcessingStep;
  message: string;
  progress?: number;
  transcript?: string;
  clips?: ClipInfo[];
  error?: string;
}

export interface ClipInfo {
  index: number;
  filename: string;
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  subtitle: string;
  duration: number;
}

const STEP_CONFIG: Record<ProcessingStep, { icon: React.ElementType; label: string; description: string }> = {
  uploading: { icon: Upload, label: 'Uploading Video', description: 'Sending your video to the server...' },
  extracting: { icon: Volume2, label: 'Extracting Audio', description: 'Pulling audio track from your video...' },
  transcribing: { icon: Scissors, label: 'Transcribing Speech', description: 'AI is listening and converting speech to text...' },
  analyzing: { icon: Brain, label: 'Analyzing Content', description: 'Finding the most interesting moments...' },
  generating: { icon: Subtitles, label: 'Generating Clips', description: 'Creating clips with burned-in subtitles...' },
  done: { icon: CheckCircle2, label: 'Complete!', description: 'Your clips are ready!' },
  error: { icon: Upload, label: 'Error', description: 'Something went wrong' },
};

const STEP_ORDER: ProcessingStep[] = ['uploading', 'extracting', 'transcribing', 'analyzing', 'generating', 'done'];

interface ProcessProgressProps {
  currentStep: ProcessingStep;
  message: string;
  progress?: number;
  error?: string;
}

export function ProcessProgress({ currentStep, message, progress, error }: ProcessProgressProps) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  const isErrored = currentStep === 'error';

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800/50">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              isErrored ? 'bg-red-500/20' : 'bg-amber-500/20 animate-pulse'
            )}>
              {isErrored ? (
                <div className="w-3 h-3 rounded-full bg-red-400" />
              ) : (
                <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                {isErrored ? 'Processing Failed' : 'Processing Video'}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">{message}</p>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {!isErrored && (
          <div className="px-6 pt-4">
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-700 ease-out"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="px-6 py-4 space-y-1">
          {STEP_ORDER.slice(0, -1).map((step, idx) => {
            const config = STEP_CONFIG[step];
            const isCompleted = idx < currentIndex;
            const isCurrent = step === currentStep;

            return (
              <div key={step} className={cn(
                'flex items-center gap-3 py-2 px-3 rounded-lg transition-all duration-300',
                isCurrent && !isErrored && 'bg-amber-500/5',
              )}>
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300',
                  isCompleted
                    ? 'bg-emerald-500/20'
                    : isCurrent && !isErrored
                    ? 'bg-amber-500/20'
                    : 'bg-zinc-800/50'
                )}>
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (() => {
                    const Icon = config.icon;
                    return isCurrent && !isErrored ? (
                      <Icon className="w-4 h-4 text-amber-400 animate-pulse" />
                    ) : (
                      <Icon className="w-4 h-4 text-zinc-600" />
                    );
                  })()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-sm font-medium transition-colors',
                    isCompleted ? 'text-emerald-300' : isCurrent ? 'text-zinc-100' : 'text-zinc-500'
                  )}>
                    {config.label}
                  </p>
                  <p className={cn(
                    'text-xs transition-colors',
                    isCurrent ? 'text-zinc-400' : 'text-zinc-600'
                  )}>
                    {config.description}
                  </p>
                </div>
                {isCurrent && !isErrored && (
                  <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        {/* Error message */}
        {isErrored && error && (
          <div className="px-6 pb-4">
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
