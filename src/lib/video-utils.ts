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

export async function downloadYouTubeVideo(
  url: string, outputDir: string, onProgress?: (percent: number) => void
): Promise<{ videoPath: string; title: string; duration: number }> {
  let ytDlp: string;
  try { ytDlp = getYtDlpPath(); }
  catch { throw new Error('YouTube download is not available. Please upload a video file instead.'); }

  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`[yt-dlp] Downloading: ${url}`);

  const outputPath = path.join(outputDir, 'yt_video.%(ext)s');
  let title = 'YouTube Video', duration = 0;

  try {
    const info = await spawnYtDlp(['--no-download', '--print', '%(title)s', '--print', '%(duration)s', '--no-playlist', '--no-warnings', '--ignore-errors', url], 30000);
    const lines = info.stdout.trim().split('\n').filter(Boolean);
    if (lines.length >= 1) title = lines[0].trim();
    if (lines.length >= 2) duration = parseFloat(lines[1].trim()) || 0;
  } catch {}

  if (duration > 600) throw new Error(`Video too long (${Math.floor(duration / 60)}min). Max 10 min.`);

  const dl = await spawnYtDlp([
    '-f', 'best[height<=720][ext=mp4]/best[height<=720][ext=webm]/best[height<=720]/best',
    '--max-filesize', '200M', '-o', outputPath, '--no-playlist', '--newline', '--no-warnings', '--progress', '--ignore-errors', url,
  ], 300000);

  const files = fs.readdirSync(outputDir).filter(f => f.startsWith('yt_video.') && /\.(mp4|webm|mkv|avi|mov|flv|3gp)$/i.test(f));
  if (files.length === 0) {
    const anyFiles = fs.readdirSync(outputDir).filter(f => /\.(mp4|webm|mkv|avi|mov|flv|3gp)$/i.test(f));
    if (!anyFiles.length) throw new Error('Failed to download video.');
    const p = path.join(outputDir, anyFiles[0]);
    if (fs.statSync(p).size < 1000) { fs.unlinkSync(p); throw new Error('Downloaded file too small.'); }
    return { videoPath: p, title, duration: getVideoDuration(p) };
  }
  const vp = path.join(outputDir, files[0]);
  if (fs.statSync(vp).size < 1000) { fs.unlinkSync(vp); throw new Error('Downloaded file too small.'); }
  return { videoPath: vp, title, duration: getVideoDuration(vp) };
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
