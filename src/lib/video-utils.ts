import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const FFMPEG = 'ffmpeg';
const FFPROBE = 'ffprobe';

/**
 * Find yt-dlp binary path at runtime
 */
function findYtDlp(): string {
  const candidates = [
    '/home/z/.venv/bin/yt-dlp',
    '/home/z/.local/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        // Verify it's executable
        execSync(`${candidate} --version`, { encoding: 'utf-8', timeout: 5000 });
        return candidate;
      }
    } catch {}
  }

  // Try `which yt-dlp`
  try {
    const result = execSync('which yt-dlp', { encoding: 'utf-8' }).trim();
    if (result) return result;
  } catch {}

  throw new Error('yt-dlp is not installed on this server. YouTube downloading is not available.');
}

let _ytDlpPath: string | null = null;
function getYtDlpPath(): string {
  if (!_ytDlpPath) {
    _ytDlpPath = findYtDlp();
    console.log(`[yt-dlp] Using binary at: ${_ytDlpPath}`);
  }
  return _ytDlpPath;
}

/**
 * Get video duration in seconds using ffprobe
 */
export function getVideoDuration(filePath: string): number {
  try {
    const output = execSync(
      `${FFPROBE} -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!output || isNaN(parseFloat(output))) {
      throw new Error('Could not read video duration.');
    }
    return parseFloat(output);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Could not read')) throw err;
    throw new Error('Invalid video file. Please upload a valid MP4, MOV, or AVI file.');
  }
}

/**
 * Get video info (resolution, codec, etc.)
 */
export function getVideoInfo(filePath: string): {
  width: number;
  height: number;
  duration: number;
  codec: string;
} {
  const output = execSync(
    `${FFPROBE} -v error -select_streams v:0 -show_entries stream=width,height,codec_name,duration -of csv=p=0 "${filePath}"`,
    { encoding: 'utf-8' }
  ).trim();
  const [width, height, codec] = output.split(',');
  const formatDuration = getVideoDuration(filePath);
  return {
    width: parseInt(width),
    height: parseInt(height),
    codec: codec || 'unknown',
    duration: formatDuration,
  };
}

/**
 * Spawn yt-dlp and return a promise with stdout
 */
function spawnYtDlp(args: string[], timeout: number = 300000): Promise<{ stdout: string; stderr: string; code: number }> {
  const ytDlp = getYtDlpPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlp, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
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
 * Returns the path to the downloaded video file
 */
export async function downloadYouTubeVideo(
  url: string,
  outputDir: string,
  onProgress?: (percent: number) => void
): Promise<{ videoPath: string; title: string; duration: number }> {
  // Check yt-dlp is available first
  let ytDlp: string;
  try {
    ytDlp = getYtDlpPath();
  } catch (err) {
    throw new Error('YouTube download is not available on this server. Please upload a video file instead.');
  }

  // Ensure output dir exists
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`[yt-dlp] Downloading: ${url} to ${outputDir}`);
  console.log(`[yt-dlp] Using binary: ${ytDlp}`);

  const outputPath = path.join(outputDir, 'yt_video.%(ext)s');

  // First get video info (title, duration)
  let title = 'YouTube Video';
  let duration = 0;

  try {
    const infoResult = await spawnYtDlp([
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      '--print', 'title',
      '--print', 'duration',
      '--no-download',
      '--no-playlist',
      '--no-warnings',
      url,
    ], 30000);

    const infoOutput = infoResult.stdout.trim().split('\n');
    if (infoOutput.length >= 1 && infoOutput[0].trim()) title = infoOutput[0].trim();
    if (infoOutput.length >= 2 && infoOutput[1].trim()) duration = parseFloat(infoOutput[1].trim()) || 0;

    console.log(`[yt-dlp] Video info: "${title}", ${duration}s`);
  } catch (err) {
    console.log(`[yt-dlp] Info fetch failed (non-fatal):`, err);
  }

  // Check duration limit (10 minutes)
  if (duration > 600) {
    throw new Error(`Video is too long (${Math.floor(duration / 60)} minutes). Maximum 10 minutes allowed.`);
  }

  // Download the video - best quality, max 720p
  console.log(`[yt-dlp] Starting download: ${url}`);

  const downloadResult = await spawnYtDlp([
    '--remote-components', 'ejs:github',
    '--js-runtimes', 'node',
    '-f', 'best[height<=720][ext=mp4]/best[height<=720]/best',
    '--max-filesize', '200M',
    '-o', outputPath,
    '--no-playlist',
    '--newline',
    '--no-warnings',
    '--progress',
    url,
  ], 300000);

  console.log(`[yt-dlp] Exit code: ${downloadResult.code}`);
  if (downloadResult.stderr) console.log(`[yt-dlp] stderr: ${downloadResult.stderr.slice(-500)}`);

  // yt-dlp might save the file with the actual extension (.webm, .mkv, etc.)
  // Search for any video file in the output directory
  const possibleFiles = fs.readdirSync(outputDir).filter(f =>
    f.startsWith('yt_video.') && /\.(mp4|webm|mkv|avi|mov|flv|3gp)$/i.test(f)
  );

  if (possibleFiles.length === 0) {
    // If no yt_video.* found, look for any video file
    const anyFiles = fs.readdirSync(outputDir).filter(f =>
      /\.(mp4|webm|mkv|avi|mov|flv|3gp)$/i.test(f)
    );

    if (anyFiles.length === 0) {
      console.error(`[yt-dlp] No video file found in ${outputDir}. Dir contents:`, fs.readdirSync(outputDir));
      throw new Error(
        'Failed to download YouTube video. The video might be private, age-restricted, or unavailable.'
      );
    }

    // Use the first video file found
    const actualPath = path.join(outputDir, anyFiles[0]);
    const fileSize = fs.statSync(actualPath).size;

    if (fileSize < 1000) {
      fs.unlinkSync(actualPath);
      throw new Error('Downloaded file is too small. The video might be unavailable.');
    }

    const actualDuration = getVideoDuration(actualPath);
    return {
      videoPath: actualPath,
      title: title || 'YouTube Video',
      duration: actualDuration,
    };
  }

  // Use the found file
  const videoPath = path.join(outputDir, possibleFiles[0]);
  const fileSize = fs.statSync(videoPath).size;

  if (fileSize < 1000) {
    fs.unlinkSync(videoPath);
    throw new Error('Downloaded file is too small. The video might be unavailable.');
  }

  const actualDuration = getVideoDuration(videoPath);

  return {
    videoPath,
    title: title || 'YouTube Video',
    duration: actualDuration,
  };
}

/**
 * Extract audio from video file as WAV (16kHz mono)
 */
export function extractAudio(videoPath: string, outputPath: string): void {
  try {
    execSync(
      `${FFMPEG} -y -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    throw new Error('Failed to extract audio from video. The video file may not have an audio track or may be corrupted.');
  }
}

/**
 * Split audio file into chunks of max duration (seconds)
 * Returns array of chunk file paths
 */
export function splitAudio(inputPath: string, outputDir: string, maxChunkDuration: number = 28): string[] {
  const chunks: string[] = [];

  try {
    // Get audio duration
    const duration = getAudioDuration(inputPath);
    const numChunks = Math.ceil(duration / maxChunkDuration);

    if (numChunks <= 1) {
      return [inputPath];
    }

    for (let i = 0; i < numChunks; i++) {
      const startTime = i * maxChunkDuration;
      const chunkPath = path.join(outputDir, `chunk_${String(i).padStart(3, '0')}.wav`);
      execSync(
        `${FFMPEG} -y -ss ${startTime} -i "${inputPath}" -t ${maxChunkDuration} -acodec pcm_s16le -ar 16000 -ac 1 "${chunkPath}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
      chunks.push(chunkPath);
    }
  } catch (err) {
    // If splitting fails, return original file
    console.warn('[audio] Failed to split audio, using original file:', err);
    return [inputPath];
  }

  return chunks;
}

/**
 * Get audio duration in seconds
 */
function getAudioDuration(filePath: string): number {
  const output = execSync(
    `${FFPROBE} -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  return parseFloat(output) || 0;
}

/**
 * Cut a segment from a video
 */
export function cutVideo(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number
): void {
  try {
    const duration = endTime - startTime;
    execSync(
      `${FFMPEG} -y -ss ${startTime} -i "${inputPath}" -t ${duration} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    throw new Error(`Failed to cut video segment (${startTime}s - ${endTime}s).`);
  }
}

/**
 * Generate SRT subtitle file from text
 * Distributes text evenly across the clip duration
 */
export function generateSRT(subtitleText: string, duration: number, outputPath: string): void {
  const sentences = subtitleText
    .split(/(?<=[.!?])\s+|(?<=\n)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length === 0) {
    sentences.push(subtitleText.trim());
  }

  const segmentDuration = duration / sentences.length;
  let srtContent = '';

  sentences.forEach((sentence, index) => {
    const start = index * segmentDuration;
    const end = (index + 1) * segmentDuration;

    srtContent += `${index + 1}\n`;
    srtContent += `${formatSRTTime(start)} --> ${formatSRTTime(Math.min(end, duration))}\n`;
    srtContent += `${sentence}\n\n`;
  });

  fs.writeFileSync(outputPath, srtContent, 'utf-8');
}

/**
 * Burn subtitles into video
 */
export function burnSubtitles(
  inputPath: string,
  srtPath: string,
  outputPath: string
): void {
  try {
    const escapedSrtPath = srtPath.replace(/:/g, '\\:').replace(/\\/g, '\\\\');

    execSync(
      `${FFMPEG} -y -i "${inputPath}" -vf "subtitles='${escapedSrtPath}':force_style='FontSize=20,PrimaryColour=&Hffffff&,OutlineColour=&H000000&,BackColour=&H80000000&,Outline=2,Shadow=0,MarginV=30'" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    // If subtitle burning fails, just copy the clip without subtitles
    execSync(
      `${FFMPEG} -y -i "${inputPath}" -c copy "${outputPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  }
}

/**
 * Generate thumbnail from video
 */
export function generateThumbnail(
  videoPath: string,
  outputPath: string,
  timeSeconds: number = 1
): void {
  try {
    execSync(
      `${FFMPEG} -y -ss ${timeSeconds} -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}"`,
      { stdio: 'pipe' }
    );
  } catch {
    // Non-critical, ignore
  }
}

/**
 * Format seconds to SRT time format (HH:MM:SS,mmm)
 */
function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}
