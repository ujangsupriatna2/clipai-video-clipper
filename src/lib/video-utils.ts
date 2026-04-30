import { execSync, exec as execCb } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(execCb);
const FFMPEG = 'ffmpeg';
const FFPROBE = 'ffprobe';
const YT_DLP = '/home/z/.local/bin/yt-dlp';

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
 * Download a YouTube video using yt-dlp
 * Returns the path to the downloaded video file
 */
export async function downloadYouTubeVideo(
  url: string,
  outputDir: string,
  onProgress?: (percent: number) => void
): Promise<{ videoPath: string; title: string; duration: number }> {
  const outputPath = path.join(outputDir, 'yt_video.mp4');

  // First get video info (title, duration)
  let title = 'YouTube Video';
  let duration = 0;

  try {
    const infoCmd = [
      YT_DLP,
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      '--print', 'title',
      '--print', 'duration',
      '--no-download',
      '--no-playlist',
      url,
    ].join(' ');
    const { stdout } = await execAsync(infoCmd, {
      timeout: 30000,
    });
    const infoOutput = stdout.trim().split('\n');

    if (infoOutput.length >= 1) title = infoOutput[0].trim();
    if (infoOutput.length >= 2) duration = parseFloat(infoOutput[1].trim()) || 0;
  } catch {
    // Info fetch failed, continue with download
  }

  // Check duration limit (10 minutes)
  if (duration > 600) {
    throw new Error(`Video is too long (${Math.floor(duration / 60)} minutes). Maximum 10 minutes allowed.`);
  }

  // Download the video - best quality mp4, max 720p for faster processing
  const downloadCmd = [
    YT_DLP,
    '--remote-components', 'ejs:github',
    '--js-runtimes', 'node',
    '-f', 'best[height<=720][ext=mp4]/best[height<=720]/best',
    '--max-filesize', '200M',
    '-o', outputPath,
    '--no-playlist',
    '--newline',
    '--progress',
    url,
  ].join(' ');

  try {
    await execAsync(downloadCmd, {
      timeout: 300000, // 5 min timeout
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    // yt-dlp might still succeed even with stderr output
    if (!fs.existsSync(outputPath)) {
      throw new Error(
        'Failed to download YouTube video. The video might be private, age-restricted, or unavailable in this region.'
      );
    }
  }

  // Verify the downloaded file exists and is valid
  if (!fs.existsSync(outputPath)) {
    throw new Error('Download completed but file not found. Please try again.');
  }

  const fileSize = fs.statSync(outputPath).size;
  if (fileSize < 1000) {
    fs.unlinkSync(outputPath);
    throw new Error('Downloaded file is too small. The video might be unavailable.');
  }

  const actualDuration = getVideoDuration(outputPath);

  return {
    videoPath: outputPath,
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
