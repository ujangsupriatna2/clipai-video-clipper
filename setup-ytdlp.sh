#!/bin/bash
# Setup binaries for deployment (yt-dlp + FFmpeg)
# This script runs during `bun run build` before Next.js builds
#
# Strategy: Binaries are pre-committed in bin/ directory.
# If missing (e.g., fresh clone without LFS), this script downloads them.
# Errors are logged to bin/setup.log for diagnostics.

mkdir -p bin
ARCH=$(uname -m)
LOG_FILE="bin/setup.log"
echo "=== Binary setup started at $(date) ===" > "$LOG_FILE"
echo "Architecture: $ARCH" >> "$LOG_FILE"

# ============================================
# Helper: ensure xz extraction works
# ============================================
ensure_xz() {
  # Check if tar can handle xz
  if ! echo "test" | tar xJf - 2>/dev/null; then
    # Try installing xz-utils via various package managers
    echo "Installing xz-utils..." | tee -a "$LOG_FILE"
    if command -v apt-get > /dev/null 2>&1; then
      apt-get update -qq >> "$LOG_FILE" 2>&1 && apt-get install -y -qq xz-utils >> "$LOG_FILE" 2>&1 && return 0
    elif command -v yum > /dev/null 2>&1; then
      yum install -y xz >> "$LOG_FILE" 2>&1 && return 0
    elif command -v apk > /dev/null 2>&1; then
      apk add xz >> "$LOG_FILE" 2>&1 && return 0
    fi
    echo "WARNING: Could not install xz-utils. xz extraction may fail." | tee -a "$LOG_FILE"
    return 1
  fi
  return 0
}

# ============================================
# 1. Verify/Set up yt-dlp
# ============================================
echo "--- yt-dlp ---" >> "$LOG_FILE"

YTDLP_OK=0
if [ -f "bin/yt-dlp" ] && bin/yt-dlp --version > /dev/null 2>&1; then
  YTDLP_VERSION=$(bin/yt-dlp --version)
  echo "yt-dlp already present: v${YTDLP_VERSION}" | tee -a "$LOG_FILE"
  YTDLP_OK=1
fi

if [ "$YTDLP_OK" = "0" ]; then
  echo "Downloading yt-dlp binary..." | tee -a "$LOG_FILE"
  if [ "$ARCH" = "aarch64" ]; then
    curl -L --max-time 120 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64" -o bin/yt-dlp 2>>"$LOG_FILE" && YTDLP_OK=1
  else
    curl -L --max-time 120 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o bin/yt-dlp 2>>"$LOG_FILE" && YTDLP_OK=1
  fi

  if [ "$YTDLP_OK" = "0" ]; then
    echo "Platform binary failed, trying Python script..." | tee -a "$LOG_FILE"
    curl -L --max-time 120 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o bin/yt-dlp 2>>"$LOG_FILE" && YTDLP_OK=1
  fi

  if [ "$YTDLP_OK" = "1" ]; then
    chmod +x bin/yt-dlp
    if bin/yt-dlp --version > /dev/null 2>&1; then
      echo "yt-dlp $(bin/yt-dlp --version) installed successfully" | tee -a "$LOG_FILE"
    else
      echo "WARNING: yt-dlp binary exists but failed to run" | tee -a "$LOG_FILE"
      YTDLP_OK=0
    fi
  else
    echo "WARNING: yt-dlp download failed." | tee -a "$LOG_FILE"
  fi
fi

# ============================================
# 2. Verify/Set up FFmpeg + FFprobe
# ============================================
echo "--- FFmpeg ---" >> "$LOG_FILE"

FFMPEG_OK=0
if [ -f "bin/ffmpeg" ] && bin/ffmpeg -version > /dev/null 2>&1; then
  FFMPEG_VER=$(bin/ffmpeg -version 2>&1 | head -1)
  echo "FFmpeg already present: ${FFMPEG_VER}" | tee -a "$LOG_FILE"
  FFMPEG_OK=1
fi

if [ "$FFMPEG_OK" = "0" ]; then
  echo "FFmpeg not found, attempting installation..." | tee -a "$LOG_FILE"

  # Attempt 1: apt-get
  if command -v apt-get > /dev/null 2>&1; then
    echo "Trying apt-get install ffmpeg..." | tee -a "$LOG_FILE"
    if apt-get update -qq >> "$LOG_FILE" 2>&1 && apt-get install -y -qq ffmpeg >> "$LOG_FILE" 2>&1; then
      FFMPEG_PATH=$(which ffmpeg 2>/dev/null)
      FFPROBE_PATH=$(which ffprobe 2>/dev/null)
      if [ -n "$FFMPEG_PATH" ] && [ -n "$FFPROBE_PATH" ]; then
        cp "$FFMPEG_PATH" bin/ffmpeg
        cp "$FFPROBE_PATH" bin/ffprobe
        chmod +x bin/ffmpeg bin/ffprobe
        FFMPEG_OK=1
        echo "FFmpeg installed via apt-get" | tee -a "$LOG_FILE"
      fi
    fi
  fi

  # Attempt 2: johnvansickle.com (ensure xz support first)
  if [ "$FFMPEG_OK" = "0" ]; then
    ensure_xz
    echo "Downloading FFmpeg from johnvansickle.com..." | tee -a "$LOG_FILE"
    TMPDIR=$(mktemp -d)
    DOWNLOAD_OK=0
    curl -L --max-time 300 "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" -o "$TMPDIR/ffmpeg.tar.xz" 2>>"$LOG_FILE" && DOWNLOAD_OK=1

    if [ "$DOWNLOAD_OK" = "1" ]; then
      DL_SIZE=$(stat -f%z "$TMPDIR/ffmpeg.tar.xz" 2>/dev/null || stat -c%s "$TMPDIR/ffmpeg.tar.xz" 2>/dev/null || echo 0)
      echo "Downloaded ${DL_SIZE} bytes" >> "$LOG_FILE"
      if [ "$DL_SIZE" -gt 1000000 ]; then
        if tar xf "$TMPDIR/ffmpeg.tar.xz" -C "$TMPDIR" 2>>"$LOG_FILE"; then
          FFMPEG_DIR=$(ls -d "$TMPDIR"/ffmpeg-*-static 2>/dev/null | head -1)
          if [ -n "$FFMPEG_DIR" ] && [ -f "$FFMPEG_DIR/ffmpeg" ]; then
            cp "$FFMPEG_DIR/ffmpeg" bin/ffmpeg
            cp "$FFMPEG_DIR/ffprobe" bin/ffprobe
            chmod +x bin/ffmpeg bin/ffprobe
            FFMPEG_OK=1
            echo "FFmpeg installed from johnvansickle.com" | tee -a "$LOG_FILE"
          else
            echo "ERROR: Could not find binaries in extracted archive" >> "$LOG_FILE"
          fi
        else
          echo "ERROR: tar extraction failed (xz may be missing)" >> "$LOG_FILE"
          # Fallback: try with xz command
          if command -v xz > /dev/null 2>&1; then
            echo "Retrying with xz -dc pipe..." >> "$LOG_FILE"
            xz -dc "$TMPDIR/ffmpeg.tar.xz" 2>>"$LOG_FILE" | tar xf - -C "$TMPDIR" 2>>"$LOG_FILE" && \
            FFMPEG_DIR=$(ls -d "$TMPDIR"/ffmpeg-*-static 2>/dev/null | head -1) && \
            [ -n "$FFMPEG_DIR" ] && [ -f "$FFMPEG_DIR/ffmpeg" ] && \
            cp "$FFMPEG_DIR/ffmpeg" bin/ffmpeg && cp "$FFMPEG_DIR/ffprobe" bin/ffprobe && \
            chmod +x bin/ffmpeg bin/ffprobe && FFMPEG_OK=1 && \
            echo "FFmpeg installed from johnvansickle.com (xz pipe)" | tee -a "$LOG_FILE"
          fi
        fi
      else
        echo "ERROR: Download too small (${DL_SIZE} bytes)" >> "$LOG_FILE"
      fi
    else
      echo "ERROR: curl download failed" >> "$LOG_FILE"
    fi
    rm -rf "$TMPDIR"
  fi

  # Attempt 3: BtbN GitHub
  if [ "$FFMPEG_OK" = "0" ]; then
    ensure_xz
    echo "Downloading FFmpeg from BtbN GitHub..." | tee -a "$LOG_FILE"
    TMPDIR=$(mktemp -d)
    DOWNLOAD_OK=0
    curl -L --max-time 600 "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz" -o "$TMPDIR/ffmpeg.tar.xz" 2>>"$LOG_FILE" && DOWNLOAD_OK=1

    if [ "$DOWNLOAD_OK" = "1" ]; then
      DL_SIZE=$(stat -f%z "$TMPDIR/ffmpeg.tar.xz" 2>/dev/null || stat -c%s "$TMPDIR/ffmpeg.tar.xz" 2>/dev/null || echo 0)
      echo "Downloaded ${DL_SIZE} bytes" >> "$LOG_FILE"
      if [ "$DL_SIZE" -gt 10000000 ]; then
        tar xf "$TMPDIR/ffmpeg.tar.xz" -C "$TMPDIR" 2>>"$LOG_FILE" || \
        (command -v xz > /dev/null 2>&1 && xz -dc "$TMPDIR/ffmpeg.tar.xz" 2>>"$LOG_FILE" | tar xf - -C "$TMPDIR" 2>>"$LOG_FILE")
        FFMPEG_DIR=$(ls -d "$TMPDIR"/ffmpeg-*-linux64-gpl 2>/dev/null | head -1)
        if [ -n "$FFMPEG_DIR" ] && [ -f "$FFMPEG_DIR/bin/ffmpeg" ]; then
          cp "$FFMPEG_DIR/bin/ffmpeg" bin/ffmpeg
          cp "$FFMPEG_DIR/bin/ffprobe" bin/ffprobe
          chmod +x bin/ffmpeg bin/ffprobe
          FFMPEG_OK=1
          echo "FFmpeg installed from BtbN GitHub" | tee -a "$LOG_FILE"
        fi
      fi
    fi
    rm -rf "$TMPDIR"
  fi
fi

if [ "$FFMPEG_OK" = "1" ]; then
  if bin/ffmpeg -version > /dev/null 2>&1; then
    echo "FFmpeg ready: $(bin/ffmpeg -version 2>&1 | head -1)" | tee -a "$LOG_FILE"
  else
    echo "WARNING: FFmpeg binary exists but failed to run" | tee -a "$LOG_FILE"
    FFMPEG_OK=0
  fi
else
  echo "WARNING: FFmpeg installation failed from all sources." | tee -a "$LOG_FILE"
  echo "Video processing features will be unavailable." | tee -a "$LOG_FILE"
fi

# ============================================
# Summary
# ============================================
echo "=== Binary setup complete ===" | tee -a "$LOG_FILE"
echo "yt-dlp: $([ $YTDLP_OK = 1 ] && echo 'OK' || echo 'MISSING')" | tee -a "$LOG_FILE"
echo "FFmpeg: $([ $FFMPEG_OK = 1 ] && echo 'OK' || echo 'MISSING')" | tee -a "$LOG_FILE"
echo "bin/ contents:" >> "$LOG_FILE"
ls -lh bin/ 2>/dev/null >> "$LOG_FILE"
