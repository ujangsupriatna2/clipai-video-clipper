'use client';

import React, { useCallback, useState, useRef } from 'react';
import { Upload, Film, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface VideoUploadZoneProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];
const MAX_SIZE_MB = 100;

export function VideoUploadZone({ onFileSelect, disabled = false }: VideoUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return 'Unsupported format. Please use MP4, MOV, AVI, WebM, or MKV.';
    }
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_SIZE_MB) {
      return `File too large (${sizeMB.toFixed(1)}MB). Max ${MAX_SIZE_MB}MB.`;
    }
    return null;
  }, []);

  const handleFile = useCallback((file: File) => {
    setError(null);
    const err = validateFile(file);
    if (err) {
      setError(err);
      return;
    }
    setSelectedFile(file);
  }, [validateFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;

    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [disabled, handleFile]);

  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  }, [handleFile]);

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    setError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    if (selectedFile) onFileSelect(selectedFile);
  }, [selectedFile, onFileSelect]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer',
          'group hover:border-amber-500/50',
          isDragging
            ? 'border-amber-400 bg-amber-500/10 scale-[1.02]'
            : 'border-zinc-700/50 bg-zinc-900/30 hover:bg-zinc-900/50',
          disabled && 'opacity-50 pointer-events-none'
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
                <p className="text-lg font-medium text-zinc-100">
                  Drop your video here
                </p>
                <p className="text-sm text-zinc-400 mt-1">
                  or <span className="text-amber-400 underline underline-offset-2">click to browse</span>
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">MP4</span>
                <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">MOV</span>
                <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">AVI</span>
                <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">WebM</span>
                <span className="text-zinc-600">Max {MAX_SIZE_MB}MB</span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-4 w-full px-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center border border-amber-500/20 shrink-0">
                <Film className="w-7 h-7 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-100 truncate">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {formatSize(selectedFile.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleRemoveFile(); }}
                className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".mp4,.mov,.avi,.webm,.mkv,video/mp4,video/quicktime,video/x-msvideo,video/webm,video/x-matroska"
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {error && (
        <p className="text-sm text-red-400 mt-2 text-center">{error}</p>
      )}

      {selectedFile && (
        <div className="mt-6 flex justify-center">
          <Button
            onClick={handleSubmit}
            disabled={disabled}
            className="px-8 py-6 text-base bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-semibold rounded-xl shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 transition-all"
          >
            <Film className="w-5 h-5 mr-2" />
            Generate AI Clips
          </Button>
        </div>
      )}
    </div>
  );
}
