#!/bin/bash
# Download all required binaries for deployment (yt-dlp + FFmpeg)
# This script runs during `bun run build` before Next.js builds
# IMPORTANT: Do NOT use 'set -e' — we want the build to continue even if FFmpeg fails

mkdir -p bin
ARCH=$(uname -m)

# ============================================
# 1. Download yt-dlp
# ============================================
echo "=== Downloading yt-dlp binary ==="

YTDLP_OK=0
if [ "$ARCH" = "aarch64" ]; then
  echo "Downloading yt-dlp for Linux ARM64..."
  curl -L --max-time 60 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64" -o bin/yt-dlp 2>/dev/null && YTDLP_OK=1
else
  echo "Downloading yt-dlp for Linux x86_64..."
  curl -L --max-time 60 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o bin/yt-dlp 2>/dev/null && YTDLP_OK=1
fi

if [ "$YTDLP_OK" = "0" ]; then
  echo "Platform binary failed, trying Python script..."
  curl -L --max-time 60 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o bin/yt-dlp 2>/dev/null && YTDLP_OK=1
fi

if [ "$YTDLP_OK" = "1" ]; then
  chmod +x bin/yt-dlp
  if bin/yt-dlp --version > /dev/null 2>&1; then
    echo "yt-dlp $(bin/yt-dlp --version) installed successfully"
  else
    echo "WARNING: yt-dlp binary exists but failed to run"
    YTDLP_OK=0
  fi
else
  echo "WARNING: yt-dlp download failed."
fi

# ============================================
# 2. Download FFmpeg + FFprobe
# ============================================
echo "=== Setting up FFmpeg ==="

FFMPEG_OK=0

# Skip if already present and working
if [ -f "bin/ffmpeg" ] && bin/ffmpeg -version > /dev/null 2>&1; then
  echo "FFmpeg already present: $(bin/ffmpeg -version 2>&1 | head -1)"
  FFMPEG_OK=1
fi

if [ "$FFMPEG_OK" = "0" ]; then
  # Attempt 1: apt-get (works if container has root + apt)
  if command -v apt-get > /dev/null 2>&1; then
    echo "Attempting apt-get install ffmpeg..."
    if apt-get update -qq 2>/dev/null && apt-get install -y -qq ffmpeg 2>/dev/null; then
      FFMPEG_PATH=$(which ffmpeg 2>/dev/null)
      FFPROBE_PATH=$(which ffprobe 2>/dev/null)
      if [ -n "$FFMPEG_PATH" ] && [ -n "$FFPROBE_PATH" ]; then
        cp "$FFMPEG_PATH" bin/ffmpeg
        cp "$FFPROBE_PATH" bin/ffprobe
        chmod +x bin/ffmpeg bin/ffprobe
        FFMPEG_OK=1
        echo "FFmpeg installed via apt-get"
      fi
    fi
  fi
fi

if [ "$FFMPEG_OK" = "0" ]; then
  # Attempt 2: Download from johnvansickle.com (smaller ~40MB)
  echo "Downloading FFmpeg static build from johnvansickle.com..."
  TMPDIR=$(mktemp -d)
  if curl -L --max-time 180 "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" -o "$TMPDIR/ffmpeg.tar.xz" 2>/dev/null; then
    if tar xf "$TMPDIR/ffmpeg.tar.xz" -C "$TMPDIR" 2>/dev/null; then
      FFMPEG_DIR=$(ls -d "$TMPDIR"/ffmpeg-*-static 2>/dev/null | head -1)
      if [ -n "$FFMPEG_DIR" ] && [ -f "$FFMPEG_DIR/ffmpeg" ]; then
        cp "$FFMPEG_DIR/ffmpeg" bin/ffmpeg
        cp "$FFMPEG_DIR/ffprobe" bin/ffprobe
        chmod +x bin/ffmpeg bin/ffprobe
        FFMPEG_OK=1
        echo "FFmpeg installed from johnvansickle.com"
      fi
    fi
  fi
  rm -rf "$TMPDIR"
fi

if [ "$FFMPEG_OK" = "0" ]; then
  # Attempt 3: Download from BtbN GitHub (larger ~135MB but reliable CDN)
  echo "Downloading FFmpeg from BtbN GitHub release..."
  TMPDIR=$(mktemp -d)
  if curl -L --max-time 300 "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz" -o "$TMPDIR/ffmpeg.tar.xz" 2>/dev/null; then
    if tar xf "$TMPDIR/ffmpeg.tar.xz" -C "$TMPDIR" 2>/dev/null; then
      FFMPEG_DIR=$(ls -d "$TMPDIR"/ffmpeg-*-linux64-gpl 2>/dev/null | head -1)
      if [ -n "$FFMPEG_DIR" ] && [ -f "$FFMPEG_DIR/bin/ffmpeg" ]; then
        cp "$FFMPEG_DIR/bin/ffmpeg" bin/ffmpeg
        cp "$FFMPEG_DIR/bin/ffprobe" bin/ffprobe
        chmod +x bin/ffmpeg bin/ffprobe
        FFMPEG_OK=1
        echo "FFmpeg installed from BtbN GitHub"
      fi
    fi
  fi
  rm -rf "$TMPDIR"
fi

if [ "$FFMPEG_OK" = "1" ]; then
  if bin/ffmpeg -version > /dev/null 2>&1; then
    echo "FFmpeg ready: $(bin/ffmpeg -version 2>&1 | head -1)"
  else
    echo "WARNING: FFmpeg binary exists but failed to run"
    FFMPEG_OK=0
  fi
else
  echo "WARNING: FFmpeg installation failed from all sources."
  echo "Video processing features will be unavailable."
  echo "YouTube download may still work for single-file formats."
fi

# ============================================
# Summary
# ============================================
echo "=== Binary setup complete ==="
echo "yt-dlp: $([ $YTDLP_OK = 1 ] && echo 'OK' || echo 'MISSING')"
echo "FFmpeg: $([ $FFMPEG_OK = 1 ] && echo 'OK' || echo 'MISSING')"
echo "bin/ contents:"
ls -lh bin/ 2>/dev/null
