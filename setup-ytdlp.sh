#!/bin/bash
# Download yt-dlp binary for deployment
echo "=== Downloading yt-dlp binary ==="

# Download yt-dlp as a standalone Python script (self-contained, no Python needed)
mkdir -p bin
curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o bin/yt-dlp 2>/dev/null
chmod +x bin/yt-dlp

# Verify it works
if ./bin/yt-dlp --version > /dev/null 2>&1; then
  echo "yt-dlp $(./bin/yt-dlp --version) installed successfully"
else
  # Fallback: try downloading the Linux ARM64/AMD64 binary
  echo "Python script failed, trying platform binary..."
  ARCH=$(uname -m)
  if [ "$ARCH" = "aarch64" ]; then
    curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64" -o bin/yt-dlp 2>/dev/null
  else
    curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" -o bin/yt-dlp 2>/dev/null
  fi
  chmod +x bin/yt-dlp
  if ./bin/yt-dlp --version > /dev/null 2>&1; then
    echo "yt-dlp $(./bin/yt-dlp --version) installed successfully (platform binary)"
  else
    echo "WARNING: yt-dlp installation failed. YouTube download will not be available."
  fi
fi
