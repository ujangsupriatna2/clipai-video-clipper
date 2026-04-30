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

Stage Summary:
- yt-dlp binary is now bundled with the deployed app
- Build process automatically downloads the latest yt-dlp
- YouTube download should work in deployed environment
- User needs to redeploy (Publish & Deploy) to get the fix
