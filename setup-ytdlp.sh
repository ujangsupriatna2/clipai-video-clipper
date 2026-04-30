#!/bin/bash
# Download yt-dlp binary for deployment (platform-native, no Python needed)
echo "=== Downloading yt-dlp binary ==="

mkdir -p bin

ARCH=$(uname -m)

# Try platform-native binary first (no Python dependency)
if [ "$ARCH" = "aarch64" ]; then
  echo "Downloading yt-dlp for Linux ARM64..."
  curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64" -o bin/yt-dlp 2>/dev/null
else
  echo "Downloading yt-dlp for Linux x86_64..."
  curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o bin/yt-dlp 2>/dev/null
fi
chmod +x bin/yt-dlp

# Verify it works
if ./bin/yt-dlp --version > /dev/null 2>&1; then
  echo "yt-dlp $(./bin/yt-dlp --version) installed successfully (platform binary)"
else
  # Fallback: try the Python-based script
  echo "Platform binary failed, trying Python script..."
  curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o bin/yt-dlp 2>/dev/null
  chmod +x bin/yt-dlp
  if ./bin/yt-dlp --version > /dev/null 2>&1; then
    echo "yt-dlp $(./bin/yt-dlp --version) installed successfully (Python script)"
  else
    echo "WARNING: yt-dlp installation failed. YouTube download will not be available."
  fi
fi
