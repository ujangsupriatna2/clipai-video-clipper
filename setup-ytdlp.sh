#!/bin/bash
# Setup binaries for deployment (yt-dlp only)
# FFmpeg is downloaded at runtime via ensureFFmpeg() in video-utils.ts
#
# Why not bundle FFmpeg? The deployed platform has a file size limit (~50MB).
# yt-dlp (35MB) works, but ffmpeg (77MB) gets silently dropped during packaging.
# So FFmpeg is downloaded at first runtime request using Python tarfile for extraction.

mkdir -p bin
ARCH=$(uname -m)
echo "=== Binary setup started at $(date) ==="

# ============================================
# yt-dlp
# ============================================
YTDLP_OK=0
if [ -f "bin/yt-dlp" ] && bin/yt-dlp --version > /dev/null 2>&1; then
  echo "yt-dlp already present: v$(bin/yt-dlp --version)"
  YTDLP_OK=1
fi

if [ "$YTDLP_OK" = "0" ]; then
  echo "Downloading yt-dlp binary..."
  if [ "$ARCH" = "aarch64" ]; then
    curl -L --max-time 120 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64" -o bin/yt-dlp 2>/dev/null && YTDLP_OK=1
  else
    curl -L --max-time 120 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o bin/yt-dlp 2>/dev/null && YTDLP_OK=1
  fi

  if [ "$YTDLP_OK" = "0" ]; then
    curl -L --max-time 120 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o bin/yt-dlp 2>/dev/null && YTDLP_OK=1
  fi

  if [ "$YTDLP_OK" = "1" ]; then
    chmod +x bin/yt-dlp
    if bin/yt-dlp --version > /dev/null 2>&1; then
      echo "yt-dlp $(bin/yt-dlp --version) installed"
    else
      echo "WARNING: yt-dlp binary failed to run"
      YTDLP_OK=0
    fi
  else
    echo "WARNING: yt-dlp download failed."
  fi
fi

# ============================================
# Summary
# ============================================
echo "=== Setup complete: yt-dlp=$([ $YTDLP_OK = 1 ] && echo 'OK' || echo 'MISSING') ==="
echo "NOTE: FFmpeg will be auto-downloaded at runtime on first video processing request."
ls -lh bin/ 2>/dev/null
