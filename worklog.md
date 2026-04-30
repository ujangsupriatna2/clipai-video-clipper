---
Task ID: 3
Agent: Main
Task: Add YouTube URL support

Work Log:
- Installed yt-dlp (2026.03.17) at /home/z/.local/bin/yt-dlp
- Updated video-utils.ts: added downloadYouTubeVideo() function
  - Gets video title and duration before download
  - Downloads best quality up to 720p, mp4 format
  - 10 minute max duration limit
  - 5 minute download timeout
  - Progress reporting support
- Updated video-upload-zone.tsx: dual input mode (YouTube URL / File Upload)
  - Toggle buttons to switch between modes
  - URL validation for YouTube patterns
  - Visual feedback (green checkmark for valid URL)
- Updated process API route: supports both JSON body (YouTube) and FormData (file upload)
- Updated page.tsx: added processYouTubeUrl() handler
- Fixed server keep-alive with auto-restart loop
- Fixed cross-origin issue with allowedDevOrigins: ["*"]

Stage Summary:
- Users can now paste YouTube links OR upload video files
- yt-dlp downloads YouTube videos (max 10 min, 720p)
- Full pipeline works for both input types
- Server auto-restarts if crashed
