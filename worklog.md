---
Task ID: 4
Agent: Main
Task: Fix YouTube download + audio chunking for ASR API limit

Work Log:
- Fixed yt-dlp download "file not found" error:
  - Changed from execAsync (shell-based) to spawn (direct process) to avoid shell escaping issues
  - Dynamic yt-dlp binary detection: checks /home/z/.venv/bin, /home/z/.local/bin, /usr/local/bin, /usr/bin, and `which`
  - Changed output template from `yt_video.mp4` to `yt_video.%(ext)s` to handle any format
  - Added fallback search for any video file in output dir if expected name doesn't match
  - Better error logging (exit code, stderr, dir contents)
- Fixed ASR API 30-second limit:
  - Added splitAudio() function to split audio into 28s chunks via FFmpeg
  - Process route now transcribes each chunk separately
  - Chunks are transcribed in sequence with progress updates
  - Results are combined into full transcript
  - Individual chunk failures don't stop the whole process
- Fixed next.config.ts: changed allowedDevOrigins from regex to string
- Pushed fix to GitHub: https://github.com/ujangsupriatna2/clipai-video-clipper

Stage Summary:
- YouTube download now works reliably (tested: Rick Astley video downloads and extracts audio)
- Audio chunking supports videos of any length (split into 28s chunks for ASR API)
- Committed and pushed: user needs to redeploy to get the fixes
