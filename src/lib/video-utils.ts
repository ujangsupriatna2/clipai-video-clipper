import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// ============================================
// Binary path resolution + runtime fallback
// ============================================

let _downloading = false;
let _ffmpeg: string | null = null;
let _ffprobe: string | null = null;
let _ytdlp: string | null = null;

function findBinary(name: string): string {
  const bundled = path.join(process.cwd(), 'bin', name);
  if (fs.existsSync(bundled)) {
    try {
      execSync(`"${bundled}" --version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      return bundled;
    } catch {}
  }
  try {
    const result = execSync(`which ${name}`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
    if (result) return result;
  } catch {}
  throw new Error(`Required binary "${name}" not found.`);
}

function getFFmpeg(): string {
  if (!_ffmpeg) _ffmpeg = findBinary('ffmpeg');
  return _ffmpeg;
}

function getFFprobe(): string {
  if (!_ffprobe) _ffprobe = findBinary('ffprobe');
  return _ffprobe;
}

function getYtDlpPath(): string {
  if (!_ytdlp) {
    try { _ytdlp = findBinary('yt-dlp'); }
    catch { throw new Error('YouTube download is not available. Please upload a video file instead.'); }
  }
  return _ytdlp;
}

/**
 * Download FFmpeg at runtime using whatever tools are available in the environment.
 *
 * Strategy (in order):
 * 1. apt-get install ffmpeg       — works in deploy (has root + apt)
 * 2. apt-get install curl python3 — then download + extract via Python
 * 3. python3 (if already present) — download via python3 urllib + extract
 */
async function downloadFFmpeg(): Promise<boolean> {
  if (_downloading) return false;
  _downloading = true;

  const binDir = path.join(process.cwd(), 'bin');
  try { fs.mkdirSync(binDir, { recursive: true }); } catch {}

  const arch = execSync('uname -m', { encoding: 'utf-8' }).trim();

  // ── Step 1: apt-get install ffmpeg (fastest, no download needed) ──
  console.log('[ffmpeg] Trying apt-get install ffmpeg...');
  try {
    execSync(
      'apt-get update -qq && apt-get install -y --no-install-recommends ffmpeg 2>&1',
      { encoding: 'utf-8', timeout: 120000, stdio: 'pipe' }
    );
    const ffPath = execSync('which ffmpeg', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
    const fpPath = execSync('which ffprobe', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
    if (ffPath && fpPath) {
      fs.copyFileSync(ffPath, path.join(binDir, 'ffmpeg'));
      fs.copyFileSync(fpPath, path.join(binDir, 'ffprobe'));
      fs.chmodSync(path.join(binDir, 'ffmpeg'), 0o755);
      fs.chmodSync(path.join(binDir, 'ffprobe'), 0o755);
      console.log('[ffmpeg] Installed via apt-get');
      _downloading = false;
      return true;
    }
  } catch (err) {
    console.log('[ffmpeg] apt-get failed:', err instanceof Error ? err.message : String(err).slice(0, 200));
  }

  // ── Step 2: install tools + download static binary ──
  // Check what's available
  const hasPython = !!findBinarySafe('python3');
  const hasCurl = !!findBinarySafe('curl');
  const hasWget = !!findBinarySafe('wget');
  console.log(`[ffmpeg] Tools: python3=${hasPython}, curl=${hasCurl}, wget=${hasWget}, apt-get=${!!findBinarySafe('apt-get')}`);

  // Install missing tools via apt-get
  const needsInstall: string[] = [];
  if (!hasPython) needsInstall.push('python3');
  if (!hasCurl) needsInstall.push('curl');
  if (needsInstall.length > 0) {
    try {
      console.log(`[ffmpeg] Installing ${needsInstall.join(' ')} via apt-get...`);
      execSync(`apt-get install -y --no-install-recommends ${needsInstall.join(' ')}`, {
        encoding: 'utf-8', timeout: 120000, stdio: 'pipe'
      });
      console.log('[ffmpeg] Tools installed');
    } catch (err) {
      console.log('[ffmpeg] Failed to install tools:', err instanceof Error ? err.message : err);
    }
  }

  // Re-check
  const hasPythonNow = !!findBinarySafe('python3');
  const hasCurlNow = !!findBinarySafe('curl');
  const hasWgetNow = !!findBinarySafe('wget');

  // ── Step 3: Download + extract static FFmpeg ──
  const downloadUrl = arch === 'aarch64'
    ? 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz'
    : 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';

  const tmpDir = fs.mkdtempSync('/tmp/ffmpeg-XXXXXX');
  const archivePath = path.join(tmpDir, 'ffmpeg.tar.xz');

  // Download using whatever tool is available
  let downloadOk = false;

  if (hasCurlNow || hasCurl) {
    try {
      console.log('[ffmpeg] Downloading via curl...');
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('curl', ['-L', '--max-time', '300', downloadUrl, '-o', archivePath], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`curl exit ${code}`)));
        proc.on('error', reject);
      });
      downloadOk = true;
    } catch (err) {
      console.log('[ffmpeg] curl failed:', err instanceof Error ? err.message : err);
    }
  }

  if (!downloadOk && (hasWgetNow || hasWget)) {
    try {
      console.log('[ffmpeg] Downloading via wget...');
      execSync(`wget -q --timeout=300 -O "${archivePath}" "${downloadUrl}"`, { timeout: 300000, stdio: 'pipe' });
      downloadOk = true;
    } catch (err) {
      console.log('[ffmpeg] wget failed:', err instanceof Error ? err.message : err);
    }
  }

  if (!downloadOk && hasPythonNow) {
    try {
      console.log('[ffmpeg] Downloading via python3 urllib...');
      execSync(
        `python3 -W ignore -c "import urllib.request; urllib.request.urlretrieve('${downloadUrl}','${archivePath}')"`,
        { encoding: 'utf-8', timeout: 300000, stdio: 'pipe' }
      );
      downloadOk = true;
    } catch (err) {
      console.log('[ffmpeg] python3 download failed:', err instanceof Error ? err.message : err);
    }
  }

  if (!downloadOk) {
    console.error('[ffmpeg] No download method available');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _downloading = false;
    return false;
  }

  // Check file size
  const fileSize = fs.statSync(archivePath).size;
  console.log(`[ffmpeg] Downloaded ${Math.round(fileSize / 1024 / 1024)}MB`);
  if (fileSize < 1000000) {
    console.error('[ffmpeg] Download too small');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _downloading = false;
    return false;
  }

  // Extract
  console.log('[ffmpeg] Extracting...');
  let extracted = false;

  if (hasPythonNow || hasPython) {
    try {
      execSync(
        `python3 -W ignore -c "import tarfile; t=tarfile.open('${archivePath}','r:xz'); t.extractall('${tmpDir}'); t.close()"`,
        { encoding: 'utf-8', timeout: 120000, stdio: 'pipe' }
      );
      extracted = true;
    } catch (err) {
      console.log('[ffmpeg] Python extraction failed:', err instanceof Error ? err.message : err);
    }
  }

  if (!extracted) {
    // Try installing xz-utils and using tar
    try {
      execSync('apt-get install -y --no-install-recommends xz-utils 2>/dev/null', { timeout: 60000, stdio: 'pipe' });
      execSync(`tar xf "${archivePath}" -C "${tmpDir}"`, { timeout: 120000, stdio: 'pipe' });
      extracted = true;
    } catch {}
  }

  if (!extracted) {
    console.error('[ffmpeg] Extraction failed');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _downloading = false;
    return false;
  }

  // Find binaries
  const dirName = fs.readdirSync(tmpDir).find(f => f.includes('ffmpeg') && f.includes('static'));
  if (!dirName) {
    console.error('[ffmpeg] Archive structure unexpected:', fs.readdirSync(tmpDir));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _downloading = false;
    return false;
  }

  const base = path.join(tmpDir, dirName);
  const ffmpegSrc = path.join(base, 'ffmpeg');
  const ffprobeSrc = path.join(base, 'ffprobe');

  if (!fs.existsSync(ffmpegSrc)) {
    console.error('[ffmpeg] ffmpeg binary not found in archive');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _downloading = false;
    return false;
  }

  fs.copyFileSync(ffmpegSrc, path.join(binDir, 'ffmpeg'));
  if (fs.existsSync(ffprobeSrc)) fs.copyFileSync(ffprobeSrc, path.join(binDir, 'ffprobe'));
  fs.chmodSync(path.join(binDir, 'ffmpeg'), 0o755);
  fs.chmodSync(path.join(binDir, 'ffprobe'), 0o755);

  const ver = execSync(`"${path.join(binDir, 'ffmpeg')}" -version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
  console.log(`[ffmpeg] Installed: ${ver.split('\n')[0]}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  _downloading = false;
  return true;
}

/** Safe binary check (no throw) */
function findBinarySafe(name: string): string | null {
  try {
    const bundled = path.join(process.cwd(), 'bin', name);
    if (fs.existsSync(bundled)) return bundled;
    return execSync(`which ${name}`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim() || null;
  } catch { return null; }
}

export async function ensureFFmpeg(): Promise<boolean> {
  try { getFFmpeg(); return true; } catch {}
  console.log('[ffmpeg] Not found, starting runtime download...');
  const ok = await downloadFFmpeg();
  if (ok) {
    _ffmpeg = null; _ffprobe = null;
    try { getFFmpeg(); return true; } catch {}
  }
  return false;
}

// ============================================
// Video utilities
// ============================================

export function getVideoDuration(filePath: string): number {
  const ffprobe = getFFprobe();
  try {
    const output = execSync(
      `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!output || isNaN(parseFloat(output))) throw new Error('Could not read video duration.');
    return parseFloat(output);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Could not read')) throw err;
    throw new Error('Invalid video file. FFmpeg may not be available.');
  }
}

function spawnYtDlp(args: string[], timeout: number = 300000): Promise<{ stdout: string; stderr: string; code: number }> {
  const ytDlp = getYtDlpPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlp, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('yt-dlp timed out')); }, timeout);
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code: code ?? 1 }); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

// ============================================
// YouTube video ID extraction
// ============================================

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ============================================
// Piped/Invidious API download (no cookies needed)
// ============================================

interface PipedStream {
  url: string;
  format?: string;
  quality?: string;
  mimeType?: string;
  videoOnly?: boolean;
  height?: number;
}

interface InvidiousStream {
  url: string;
  format?: string;
  qualityLabel?: string;
  type?: string;
  container?: string;
  videoOnly?: boolean;
}

async function downloadViaProxyAPI(
  videoId: string,
  outputDir: string,
  onProgress?: (percent: number) => void
): Promise<{ videoPath: string; title: string; duration: number } | null> {
  const outputPath = path.join(outputDir, 'yt_video.mp4');

  // --- Try Piped API instances ---
  const pipedInstances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://watchapi.whatever.social',
  ];

  for (const instance of pipedInstances) {
    try {
      console.log(`[piped] Trying ${instance}...`);
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;

      const data = await res.json();
      const title = data.title || 'YouTube Video';
      const duration = Math.floor(data.duration || 0);

      if (duration > 600) continue;

      // Find combined (video+audio) mp4 stream, prefer <=720p
      const streams: PipedStream[] = data.videoStreams || [];
      const combined = streams
        .filter(s => !s.videoOnly && s.mimeType?.includes('video/mp4'))
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      const stream = combined.find(s => (s.height || 999) <= 720) || combined[0];

      if (!stream?.url) {
        console.log('[piped] No suitable combined stream found');
        continue;
      }

      console.log(`[piped] Downloading from ${instance}: ${stream.quality || stream.height + 'p'} (${title})`);
      const ok = await downloadStreamToFileSync(stream.url, outputPath, onProgress);
      if (ok && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        console.log(`[piped] Success: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB`);
        return { videoPath: outputPath, title, duration };
      }
    } catch (err) {
      console.log(`[piped] ${instance} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // --- Try Invidious API instances ---
  const invidiousInstances = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://yt.drgnz.club',
  ];

  for (const instance of invidiousInstances) {
    try {
      console.log(`[invidious] Trying ${instance}...`);
      const res = await fetch(
        `${instance}/api/v1/videos/${videoId}?fields=title,lengthSeconds,formatStreams,adaptiveFormats`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) continue;

      const data = await res.json();
      const title = data.title || 'YouTube Video';
      const duration = data.lengthSeconds || 0;

      if (duration > 600) continue;

      // formatStreams = combined video+audio
      const streams: InvidiousStream[] = data.formatStreams || [];
      const sorted = streams
        .filter(s => s.type?.includes('video/mp4'))
        .sort((a, b) => {
          const qa = parseInt(a.qualityLabel || '0') || 0;
          const qb = parseInt(b.qualityLabel || '0') || 0;
          return qb - qa;
        });

      const stream = sorted.find(s => {
        const q = parseInt(s.qualityLabel || '0') || 0;
        return q <= 720;
      }) || sorted[0];

      if (!stream?.url) {
        console.log('[invidious] No suitable stream found');
        continue;
      }

      // Invidious URLs need to be proxied
      let videoUrl = stream.url;
      if (videoUrl.startsWith('/')) videoUrl = `${instance}${videoUrl}`;

      console.log(`[invidious] Downloading from ${instance}: ${stream.qualityLabel || '?'}p (${title})`);
      const ok = await downloadStreamToFileSync(videoUrl, outputPath, onProgress);
      if (ok && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        console.log(`[invidious] Success: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB`);
        return { videoPath: outputPath, title, duration };
      }
    } catch (err) {
      console.log(`[invidious] ${instance} failed:`, err instanceof Error ? err.message : err);
    }
  }

  return null;
}

/**
 * Download a URL to a file using Node.js fetch (no curl/python needed)
 */
async function downloadStreamToFileSync(
  url: string,
  outputPath: string,
  onProgress?: (percent: number) => void
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(300000),
      redirect: 'follow',
    });

    if (!res.ok || !res.body) {
      console.log(`[download] HTTP ${res.status} ${res.statusText}`);
      return false;
    }

    const totalSize = parseInt(res.headers.get('content-length') || '0');
    let downloaded = 0;

    const fileStream = fs.createWriteStream(outputPath);
    const reader = res.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(value);
      downloaded += value.length;
      if (totalSize > 0 && onProgress) {
        onProgress(Math.round((downloaded / totalSize) * 100));
      }
    }

    fileStream.end();
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    // Check size limit
    if (totalSize > 200 * 1024 * 1024) {
      fs.unlinkSync(outputPath);
      console.log('[download] File too large');
      return false;
    }

    return true;
  } catch (err) {
    console.log('[download] Failed:', err instanceof Error ? err.message : err);
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    return false;
  }
}

// ============================================
// Main YouTube download function
// ============================================

export async function downloadYouTubeVideo(
  url: string, outputDir: string, onProgress?: (percent: number) => void
): Promise<{ videoPath: string; title: string; duration: number }> {
  fs.mkdirSync(outputDir, { recursive: true });

  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Invalid YouTube URL. Please provide a valid YouTube link.');

  console.log(`[yt] Video ID: ${videoId}, URL: ${url}`);

  // ── Strategy 1: Piped/Invidious API (no cookies, no yt-dlp needed) ──
  console.log('[yt] Trying proxy API (Piped/Invidious)...');
  const proxyResult = await downloadViaProxyAPI(videoId, outputDir, onProgress);
  if (proxyResult) {
    // Get actual duration with ffprobe
    try {
      proxyResult.duration = getVideoDuration(proxyResult.videoPath);
    } catch {}
    return proxyResult;
  }

  // ── Strategy 2: yt-dlp with player_client fallback ──
  let ytDlp: string;
  try { ytDlp = getYtDlpPath(); }
  catch { throw new Error('All download methods failed. Please upload a video file instead.'); }

  console.log('[yt] Trying yt-dlp...');
  const outputPath = path.join(outputDir, 'yt_video.%(ext)s');
  let title = 'YouTube Video', duration = 0;

  const formatStrategies = [
    { f: 'best[height<=720][ext=mp4]/best[height<=720]/best', label: 'best<=720p' },
    { f: 'best[ext=mp4]/best', label: 'best-any' },
    { f: 'worst', label: 'worst' },
  ];

  for (const strategy of formatStrategies) {
    try {
      const dl = await spawnYtDlp([
        '-f', strategy.f,
        '--max-filesize', '200M',
        '-o', outputPath,
        '--no-playlist',
        '--newline',
        url,
      ], 300000);

      const files = fs.readdirSync(outputDir).filter(f =>
        f.startsWith('yt_video.') && /\.(mp4|webm|mkv|avi|mov|flv|3gp)$/i.test(f)
      );

      if (files.length > 0) {
        const vp = path.join(outputDir, files[0]);
        if (fs.statSync(vp).size > 1000) {
          return { videoPath: vp, title, duration: getVideoDuration(vp) };
        }
        try { fs.unlinkSync(vp); } catch {}
      }

      // If non-format error, don't bother trying more formats
      if (dl.code !== 0 && !dl.stderr.includes('format is not available')) break;
    } catch {}
  }

  throw new Error(
    'Failed to download video from YouTube. ' +
    'The video may be private, age-restricted, or requires sign-in. ' +
    'Try a different public video, or upload a file directly.'
  );
}

export function extractAudio(videoPath: string, outputPath: string): void {
  const ffmpeg = getFFmpeg();
  execSync(`"${ffmpeg}" -y -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
}

export function splitAudio(inputPath: string, outputDir: string, maxChunkDuration: number = 28): string[] {
  const ffprobe = getFFprobe(), ffmpeg = getFFmpeg();
  try {
    const dur = execSync(`"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${inputPath}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const n = Math.ceil((parseFloat(dur) || 0) / maxChunkDuration);
    if (n <= 1) return [inputPath];
    return Array.from({ length: n }, (_, i) => {
      const p = path.join(outputDir, `chunk_${String(i).padStart(3, '0')}.wav`);
      execSync(`"${ffmpeg}" -y -ss ${i * maxChunkDuration} -i "${inputPath}" -t ${maxChunkDuration} -acodec pcm_s16le -ar 16000 -ac 1 "${p}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
      return p;
    });
  } catch (err) { console.warn('[audio] Split failed:', err); return [inputPath]; }
}

export function cutVideo(inputPath: string, outputPath: string, startTime: number, endTime: number): void {
  const ffmpeg = getFFmpeg();
  execSync(`"${ffmpeg}" -y -ss ${startTime} -i "${inputPath}" -t ${endTime - startTime} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
}

export function generateSRT(subtitleText: string, duration: number, outputPath: string): void {
  const sentences = subtitleText.split(/(?<=[.!?])\s+|(?<=\n)/).map(s => s.trim()).filter(Boolean);
  if (!sentences.length) sentences.push(subtitleText.trim());
  const segDur = duration / sentences.length;
  let srt = '';
  sentences.forEach((s, i) => {
    const start = i * segDur, end = (i + 1) * segDur;
    srt += `${i + 1}\n${formatSRTTime(start)} --> ${formatSRTTime(Math.min(end, duration))}\n${s}\n\n`;
  });
  fs.writeFileSync(outputPath, srt, 'utf-8');
}

export function burnSubtitles(inputPath: string, srtPath: string, outputPath: string): void {
  const ffmpeg = getFFmpeg();
  const escaped = srtPath.replace(/:/g, '\\:').replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  try {
    execSync(`"${ffmpeg}" -y -i "${inputPath}" -vf "subtitles='${escaped}':force_style='FontSize=20,PrimaryColour=&Hffffff&,OutlineColour=&H000000&,BackColour=&H80000000&,Outline=2,Shadow=0,MarginV=30'" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    execSync(`"${ffmpeg}" -y -i "${inputPath}" -c copy "${outputPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
  }
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60), ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
