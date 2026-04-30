#!/bin/bash
# Download all required binaries for deployment (yt-dlp + FFmpeg)
set -e

mkdir -p bin
ARCH=$(uname -m)

# ============================================
# 1. Download yt-dlp
# ============================================
echo "=== Downloading yt-dlp binary ==="

if [ "$ARCH" = "aarch64" ]; then
  echo "Downloading yt-dlp for Linux ARM64..."
  curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64" -o bin/yt-dlp
else
  echo "Downloading yt-dlp for Linux x86_64..."
  curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o bin/yt-dlp
fi
chmod +x bin/yt-dlp

if ./bin/yt-dlp --version > /dev/null 2>&1; then
  echo "yt-dlp $(./bin/yt-dlp --version) installed successfully"
else
  echo "Platform binary failed, trying Python script..."
  curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o bin/yt-dlp
  chmod +x bin/yt-dlp
  if ./bin/yt-dlp --version > /dev/null 2>&1; then
    echo "yt-dlp $(./bin/yt-dlp --version) installed (Python script)"
  else
    echo "WARNING: yt-dlp installation failed."
  fi
fi

# ============================================
# 2. Download static FFmpeg + FFprobe
# ============================================
echo "=== Downloading FFmpeg static binary ==="

# Skip if already present and working
if [ -f "bin/ffmpeg" ] && ./bin/ffmpeg -version > /dev/null 2>&1; then
  echo "FFmpeg already present: $(./bin/ffmpeg -version 2>&1 | head -1)"
else
  echo "Downloading FFmpeg static build..."
  FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
  TMPDIR=$(mktemp -d)
  
  if curl -L "$FFMPEG_URL" -o "$TMPDIR/ffmpeg.tar.xz" --max-time 120; then
    tar xf "$TMPDIR/ffmpeg.tar.xz" -C "$TMPDIR"
    FFMPEG_DIR=$(ls -d "$TMPDIR"/ffmpeg-*-static 2>/dev/null | head -1)
    
    if [ -n "$FFMPEG_DIR" ] && [ -f "$FFMPEG_DIR/ffmpeg" ]; then
      cp "$FFMPEG_DIR/ffmpeg" bin/ffmpeg
      cp "$FFMPEG_DIR/ffprobe" bin/ffprobe
      chmod +x bin/ffmpeg bin/ffprobe
      echo "FFmpeg $(./bin/ffmpeg -version 2>&1 | head -1) installed successfully"
    else
      echo "ERROR: Failed to extract FFmpeg"
      # Try apt as last resort
      if command -v apt-get > /dev/null 2>&1; then
        echo "Trying apt-get install ffmpeg..."
        apt-get update -qq && apt-get install -y -qq ffmpeg 2>/dev/null && \
          cp $(which ffmpeg) bin/ffmpeg && cp $(which ffprobe) bin/ffprobe && \
          echo "FFmpeg installed via apt"
      fi
    fi
  else
    echo "WARNING: Failed to download FFmpeg. Video processing will not work."
  fi
  
  rm -rf "$TMPDIR"
fi

# ============================================
# Summary
# ============================================
echo "=== Binary setup complete ==="
echo "bin/ contents:"
ls -lh bin/
