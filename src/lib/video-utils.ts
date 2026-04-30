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

/**
 * Find a binary across multiple locations:
 * 1. Bundled in bin/ (for deployed env)
 * 2. System PATH
 */
function findBinary(name: string): string {
  // Bundled binary (deployed env)
  const bundled = path.join(process.cwd(), 'bin', name);
  if (fs.existsSync(bundled)) {
    try {
      execSync(`"${bundled}" --version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      return bundled;
    } catch {}
  }

  // System PATH
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
    try {
      _ytdlp = findBinary('yt-dlp');
    } catch {
      throw new Error('YouTube download is not available on this server. Please upload a video file instead.');
    }
  }
  return _ytdlp;
}

/**
 * Extract a tar.xz archive using multiple methods
 */
function extractTarXz(archivePath: string, destDir: string): boolean {
  // Method 1: Python tarfile (handles xz natively, most reliable)
  try {
    execSync(
      `python3 -W ignore -c "import tarfile; t=tarfile.open('${archivePath}','r:xz'); t.extractall('${destDir}'); t.close()"`,
      { encoding: 'utf-8', timeout: 120000, stdio: 'pipe' }
    );
    return true;
  } catch {}

  // Method 2: tar with xz flag
  try {
    execSync(`tar xf "${archivePath}" -C "${destDir}"`, { timeout: 120000, stdio: 'pipe' });
    return true;
  } catch {}

  // Method 3: xz pipe
  try {
    execSync(`xz -dc "${archivePath}" | tar xf - -C "${destDir}"`, { timeout: 120000, stdio: 'pipe' });
    return true;
  } catch {}

  return false;
}

/**
 * Download FFmpeg static binary at runtime
 */
async function downloadFFmpeg(): Promise<boolean> {
  if (_downloading) return false;
  _downloading = true;

  const binDir = path.join(process.cwd(), 'bin');
  try { fs.mkdirSync(binDir, { recursive: true }); } catch {}

  const sources = [
    {
      name: 'johnvansickle.com (~40MB)',
      url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
      minSize: 1000000,
      findBinaries: (tmpDir: string): string[] | null => {
        const dir = fs.readdirSync(tmpDir).find(f => f.includes('ffmpeg') && f.includes('static'));
        if (!dir) return null;
        const base = path.join(tmpDir, dir);
        return [path.join(base, 'ffmpeg'), path.join(base, 'ffprobe')];
      },
    },
    {
      name: 'BtbN GitHub (~134MB)',
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
      minSize: 10000000,
      findBinaries: (tmpDir: string): string[] | null => {
        const dir = fs.readdirSync(tmpDir).find(f => f.includes('linux64-gpl'));
        if (!dir) return null;
        const base = path.join(tmpDir, dir, 'bin');
        return [path.join(base, 'ffmpeg'), path.join(base, 'ffprobe')];
      },
    },
  ];

  for (const source of sources) {
    try {
      console.log(`[ffmpeg] Downloading from ${source.name}...`);
      const tmpDir = fs.mkdtempSync('/tmp/ffmpeg-XXXXXX');
      const archivePath = path.join(tmpDir, 'ffmpeg.tar.xz');

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('curl', [
          '-L', '--max-time', '600',
          source.url, '-o', archivePath,
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        let stderr = '';
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`curl exit ${code}: ${stderr.slice(-200)}`));
        });
        proc.on('error', reject);
      });

      const fileSize = fs.statSync(archivePath).size;
      console.log(`[ffmpeg] Downloaded ${Math.round(fileSize / 1024 / 1024)}MB`);

      if (fileSize < source.minSize) {
        console.warn(`[ffmpeg] Too small: ${fileSize} bytes`);
        fs.rmSync(tmpDir, { recursive: true });
        continue;
      }

      // Extract using Python tarfile (handles xz natively)
      console.log('[ffmpeg] Extracting...');
      if (!extractTarXz(archivePath, tmpDir)) {
        console.warn('[ffmpeg] Extraction failed');
        fs.rmSync(tmpDir, { recursive: true });
        continue;
      }

      const binPaths = source.findBinaries(tmpDir);
      if (!binPaths || !binPaths[0] || !fs.existsSync(binPaths[0])) {
        console.warn('[ffmpeg] Binaries not found in archive');
        fs.rmSync(tmpDir, { recursive: true });
        continue;
      }

      fs.copyFileSync(binPaths[0], path.join(binDir, 'ffmpeg'));
      if (binPaths[1] && fs.existsSync(binPaths[1])) {
        fs.copyFileSync(binPaths[1], path.join(binDir, 'ffprobe'));
      }
      fs.chmodSync(path.join(binDir, 'ffmpeg'), 0o755);
      fs.chmodSync(path.join(binDir, 'ffprobe'), 0o755);

      const ver = execSync(`"${path.join(binDir, 'ffmpeg')}" -version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      console.log(`[ffmpeg] Installed: ${ver.split('\n')[0]}`);

      fs.rmSync(tmpDir, { recursive: true });
      _downloading = false;
      return true;
    } catch (err) {
      console.warn(`[ffmpeg] Failed from ${source.name}:`, err);
    }
  }

  _downloading = false;
  return false;
}

/**
 * Ensure FFmpeg is available. If not found, try downloading at runtime.
 */
export async function ensureFFmpeg(): Promise<boolean> {
  try {
    getFFmpeg();
    return true;
  } catch {
    console.log('[ffmpeg] Not found, starting runtime download...');
    const ok = await downloadFFmpeg();
    if (ok) {
      _ffmpeg = null;
      _ffprobe = null;
      try {
        getFFmpeg();
        return true;
      } catch {}
    }
    return false;
  }
}

// ============================================
// Video utilities
// ============================================

/**
 * Get video duration in seconds using ffprobe
 */
export function getVideoDuration(filePath: string): number {
  const ffprobe = getFFprobe();
  try {
    const output = execSync(
      `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!output || isNaN(parseFloat(output))) {
      throw new Error('Could not read video duration.');
    }
    return parseFloat(output);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Could not read')) throw err;
    throw new Error('Invalid video file. FFmpeg may not be available on this server.');
  }
}

/**
 * Spawn yt-dlp and return promise
 */
function spawnYtDlp(
  args: string[],
  timeout: number = 300000
): Promise<{ stdout: string; stderr: string; code: number }> {
  const ytDlp = getYtDlpPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlp, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('yt-dlp timed out'));
    }, timeout);

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Download a YouTube video using yt-dlp
 */
export async function downloadYouTubeVideo(
  url: string,
  outputDir: string,
  onProgress?: (percent: number) => void
): Promise<{ videoPath: string; title: string; duration: number }> {
  let ytDlp: string;
  try {
    ytDlp = getYtDlpPath();
  } catch {
    throw new Error('YouTube download is not available on this server. Please upload a video file instead.');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`[yt-dlp] Binary: ${ytDlp}`);
  console.log(`[yt-dlp] Downloading: ${url}`);

  const outputPath = path.join(outputDir, 'yt_video.%(ext)s');

  let title = 'YouTube Video';
  let duration = 0;

  try {
    const infoResult = await spawnYtDlp([
      '--no-download', '--print', '%(title)s', '--print', '%(duration)s',
      '--no-playlist', '--no-warnings', '--ignore-errors', url,
    ], 30000);

    const lines = infoResult.stdout.trim().split('\n').filter(Boolean);
    if (lines.length >= 1) title = lines[0].trim();
    if (lines.length >= 2) duration = parseFloat(lines[1].trim()) || 0;
  } catch (err) {
    console.warn('[yt-dlp] Info fetch failed:', err);
  }

  if (duration > 600) {
    throw new Error(`Video is too long (${Math.floor(duration / 60)}min). Max 10 minutes.`);
  }

  const downloadResult = await spawnYtDlp([
    '-f', 'best[height<=720][ext=mp4]/best[height<=720][ext=webm]/best[height<=720]/best',
    '--max-filesize', '200M', '-o', outputPath,
    '--no-playlist', '--newline', '--no-warnings', '--progress', '--ignore-errors', url,
  ], 300000);

  const possibleFiles = fs.readdirSync(outputDir).filter(f =>
    f.startsWith('yt_video.') && /\.(mp4|webm|mkv|avi|mov|flv|3gp)$/i.test(f)
  );

  if (possibleFiles.length === 0) {
    const anyFiles = fs.readdirSync(outputDir).filter(f =>
      /\.(mp4|webm|mkv|avi|mov|flv|3gp)$/i.test(f)
    );
    if (!anyFiles.length) throw new Error('Failed to download video.');
    const actualPath = path.join(outputDir, anyFiles[0]);
    if (fs.statSync(actualPath).size < 1000) {
      fs.unlinkSync(actualPath);
      throw new Error('Downloaded file too small.');
    }
    return { videoPath: actualPath, title, duration: getVideoDuration(actualPath) };
  }

  const videoPath = path.join(outputDir, possibleFiles[0]);
  if (fs.statSync(videoPath).size < 1000) {
    fs.unlinkSync(videoPath);
    throw new Error('Downloaded file too small.');
  }

  return { videoPath, title, duration: getVideoDuration(videoPath) };
}

/**
 * Extract audio from video as WAV (16kHz mono)
 */
export function extractAudio(videoPath: string, outputPath: string): void {
  const ffmpeg = getFFmpeg();
  execSync(
    `"${ffmpeg}" -y -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`,
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

/**
 * Split audio into chunks for ASR (30s max)
 */
export function splitAudio(inputPath: string, outputDir: string, maxChunkDuration: number = 28): string[] {
  const ffprobe = getFFprobe();
  const ffmpeg = getFFmpeg();
  try {
    const duration = execSync(
      `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${inputPath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const numChunks = Math.ceil((parseFloat(duration) || 0) / maxChunkDuration);
    if (numChunks <= 1) return [inputPath];

    const chunks: string[] = [];
    for (let i = 0; i < numChunks; i++) {
      const chunkPath = path.join(outputDir, `chunk_${String(i).padStart(3, '0')}.wav`);
      execSync(
        `"${ffmpeg}" -y -ss ${i * maxChunkDuration} -i "${inputPath}" -t ${maxChunkDuration} -acodec pcm_s16le -ar 16000 -ac 1 "${chunkPath}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
      chunks.push(chunkPath);
    }
    return chunks;
  } catch (err) {
    console.warn('[audio] Split failed, using original:', err);
    return [inputPath];
  }
}

/**
 * Cut a video segment
 */
export function cutVideo(inputPath: string, outputPath: string, startTime: number, endTime: number): void {
  const ffmpeg = getFFmpeg();
  execSync(
    `"${ffmpeg}" -y -ss ${startTime} -i "${inputPath}" -t ${endTime - startTime} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

/**
 * Generate SRT subtitle file
 */
export function generateSRT(subtitleText: string, duration: number, outputPath: string): void {
  const sentences = subtitleText
    .split(/(?<=[.!?])\s+|(?<=\n)/)
    .map(s => s.trim())
    .filter(Boolean);

  if (!sentences.length) sentences.push(subtitleText.trim());

  const segDur = duration / sentences.length;
  let srt = '';

  sentences.forEach((sentence, i) => {
    const start = i * segDur;
    const end = (i + 1) * segDur;
    srt += `${i + 1}\n${formatSRTTime(start)} --> ${formatSRTTime(Math.min(end, duration))}\n${sentence}\n\n`;
  });

  fs.writeFileSync(outputPath, srt, 'utf-8');
}

/**
 * Burn subtitles into video
 */
export function burnSubtitles(inputPath: string, srtPath: string, outputPath: string): void {
  const ffmpeg = getFFmpeg();
  const escaped = srtPath.replace(/:/g, '\\:').replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  try {
    execSync(
      `"${ffmpeg}" -y -i "${inputPath}" -vf "subtitles='${escaped}':force_style='FontSize=20,PrimaryColour=&Hffffff&,OutlineColour=&H000000&,BackColour=&H80000000&,Outline=2,Shadow=0,MarginV=30'" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (subErr) {
    console.warn('[ffmpeg] Subtitle burn failed, copying without subtitles:', subErr);
    execSync(`"${ffmpeg}" -y -i "${inputPath}" -c copy "${outputPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
  }
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
