---
Task ID: 5
Agent: Main
Task: Fix YouTube download for deployed environment (no yt-dlp binary)

Work Log:
- User deployed app but got "YouTube download is not available" because deployed Docker container has no yt-dlp
- Tried multiple approaches:
  - ytdl-core v4: hasVideo/hasAudio not set, combined format detection broken
  - @distube/ytdl-core: decipher function parse failure, URLs missing
  - play-dl: YouTubeVideo class crashes, stream_from_info fails
  - youtubei.js + vm2: cipher not decrypted properly
- Final solution: bundle yt-dlp binary with the app
  - Created setup-ytdlp.sh: downloads yt-dlp from GitHub releases during build
  - Modified package.json build script to run setup-ytdlp.sh and copy bin/ to standalone
  - video-utils.ts now checks bin/yt-dlp first, then fallback paths
  - Creates uploads/ and outputs/ directories at build time
- Removed all experimental JS-only YouTube libraries
- Pushed to GitHub

---
Task ID: 6
Agent: Main
Task: Verify all APIs are connected when deployed + fix deployment issues

Work Log:
- Replaced yt-dlp Python script with native Linux x86_64 binary (no Python dependency needed)
- Updated setup-ytdlp.sh to prefer platform-native binary over Python script
- Fixed LLM API call: changed `thinking: { type: 'enabled' }` to `thinking: { type: 'disabled' }` for reliable JSON responses
- Created /api/health endpoint that tests all 5 services:
  - FFmpeg (exec check)
  - yt-dlp (binary detection across multiple paths)
  - ASR/Speech-to-Text (sends silent WAV test, verifies API responds)
  - LLM/AI Chat (sends health check prompt, verifies response)
  - Storage (uploads/outputs directories check)
- Created HealthCheckBar component showing status in footer with expandable details
- Integrated health check into app footer with click-to-expand functionality
- Tested all APIs locally: all 5 services return "ok" status
- Total health check latency: ~3.7s (ASR: 193ms, LLM: 1.8s, yt-dlp: 1.5s)

Stage Summary:
- All APIs verified working: FFmpeg ✅, yt-dlp ✅, ASR ✅, LLM ✅, Storage ✅
- Health check endpoint available at /api/health
- Footer shows live service status with expandable detail panel
- Ready for deployment - user can click footer to verify services after deploy

---
Task ID: 7
Agent: Main
Task: Fix FFmpeg missing in deployed environment + fix YouTube download failure

Work Log:
- User deployed and health check showed FFmpeg NOT available (only error message, false positive due to pipe bug)
- Root cause: deployed container has NO system FFmpeg, only yt-dlp was bundled
- YouTube download also failed because yt-dlp format `bestvideo+bestaudio` needs FFmpeg to merge
- Fixes applied:
  1. **setup-ytdlp.sh** → Now downloads static FFmpeg binary from johnvansickle.com during build (~77MB)
  2. **video-utils.ts** → Complete rewrite:
     - `findBinary()` function checks bin/ first, then system PATH
     - All functions use quoted binary paths: `"${ffmpeg}" -i ...`
     - yt-dlp format changed to single-file: `best[height<=720][ext=mp4]/best[height<=720]/best` (no merge needed)
     - Removed `--merge-output-format mp4` from yt-dlp args
  3. **Health check** → Fixed pipe bug: replaced `ffmpeg -version 2>&1 | head -1` (hides exit code) with direct `"${path}" --version` call
  4. **.gitignore** → Added bin/ffmpeg, bin/ffprobe, bin/yt-dlp (binaries downloaded during build, not committed)
- Local test: all 5 services OK, health check properly detects bundled FFmpeg

Stage Summary:
- FFmpeg is now downloaded as static binary during build (no system dependency)
- YouTube download uses single-file format (no FFmpeg merge needed for download step)
- All binary paths properly resolved: bin/ first, then system PATH
- Health check correctly reports FFmpeg status (no more false positive)
- Build flow: setup-ytdlp.sh → downloads yt-dlp + ffmpeg to bin/ → next build → cp bin/ to standalone/
