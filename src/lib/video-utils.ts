import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// ============================================
// Binary path resolution
// ============================================

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

  throw new Error(`Required binary "${name}" not found. Video processing is unavailable.`);
}

// Resolve paths once at module load
let _ffmpeg: string;
let _ffprobe: string;
let _ytdlp: string;

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

// ============================================
// Video utilities
// ============================================

/**
 * Get video duration in seconds using ffprobe
 */
export function getVideoDuration(filePath: string): number {
  try {
    const ffprobe = getFFprobe();
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
    throw new Error('Invalid video file. FFmpeg may not be available.');
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

  // Get video info first
  let title = 'YouTube Video';
  let duration = 0;

  try {
    const infoResult = await spawnYtDlp([
      '--no-download',
      '--print', '%(title)s',
      '--print', '%(duration)s',
      '--no-playlist',
      '--no-warnings',
      '--ignore-errors',
      url,
    ], 30000);

    const lines = infoResult.stdout.trim().split('\n').filter(Boolean);
    if (lines.length >= 1) title = lines[0].trim();
    if (lines.length >= 2) duration = parseFloat(lines[1].trim()) || 0;
    console.log(`[yt-dlp] Info: "${title}", ${duration}s`);
  } catch (err) {
    console.warn('[yt-dlp] Info fetch failed:', err);
  }

  if (duration > 600) {
    throw new Error(`Video is too long (${Math.floor(duration / 60)}min). Max 10 minutes.`);
  }

  // Download — prefer single-file formats that don't need FFmpeg for merging
  console.log(`[yt-dlp] Starting download...`);
  const downloadResult = await spawnYtDlp([
    '-f', 'best[height<=720][ext=mp4]/best[height<=720][ext=webm]/best[height<=720]/best',
    '--max-filesize', '200M',
    '-o', outputPath,
    '--no-playlist',
    '--newline',
    '--no-warnings',
    '--progress',
    '--ignore-errors',
    url,
  ], 300000);

  console.log(`[yt-dlp] Exit code: ${downloadResult.code}`);
  if (downloadResult.stderr) {
    console.log(`[yt-dlp] stderr (last 300 chars):`, downloadResult.stderr.slice(-300));
  }

  // Search for the downloaded file
  const possibleFiles = fs.readdirSync(outputDir).filter(f =>
    f.startsWith('yt_video.') && /\.(mp4|webm|mkv|avi|mov|flv|3gp)$/i.test(f)
  );

  if (possibleFiles.length === 0) {
    // Try any video file
    const anyFiles = fs.readdirSync(outputDir).filter(f =>
      /\.(mp4|webm|mkv|avi|mov|flv|3gp)$/i.test(f)
    );
    if (!anyFiles.length) {
      console.error(`[yt-dlp] No file found. Dir:`, fs.readdirSync(outputDir));
      console.error(`[yt-dlp] stderr:`, downloadResult.stderr.slice(-500));
      throw new Error('Failed to download video. It may be private, age-restricted, or unavailable.');
    }

    const actualPath = path.join(outputDir, anyFiles[0]);
    if (fs.statSync(actualPath).size < 1000) {
      fs.unlinkSync(actualPath);
      throw new Error('Downloaded file too small. Video may be unavailable.');
    }

    return {
      videoPath: actualPath,
      title,
      duration: getVideoDuration(actualPath),
    };
  }

  const videoPath = path.join(outputDir, possibleFiles[0]);
  const fileSize = fs.statSync(videoPath).size;

  if (fileSize < 1000) {
    fs.unlinkSync(videoPath);
    throw new Error('Downloaded file too small.');
  }

  console.log(`[yt-dlp] Done: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

  return {
    videoPath,
    title,
    duration: getVideoDuration(videoPath),
  };
}

/**
 * Extract audio from video as WAV (16kHz mono)
 */
export function extractAudio(videoPath: string, outputPath: string): void {
  const ffmpeg = getFFmpeg();
  try {
    execSync(
      `"${ffmpeg}" -y -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    throw new Error('Failed to extract audio from video.');
  }
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
  try {
    execSync(
      `"${ffmpeg}" -y -ss ${startTime} -i "${inputPath}" -t ${endTime - startTime} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    throw new Error(`Failed to cut segment (${startTime}s - ${endTime}s).`);
  }
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
