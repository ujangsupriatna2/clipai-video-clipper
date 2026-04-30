import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import ZAI from 'z-ai-web-dev-sdk';
import { ensureFFmpeg } from '@/lib/video-utils';

interface HealthCheckResult {
  service: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
  latency?: number;
  details?: string;
}

function findBinary(name: string): string | null {
  const bundled = path.join(process.cwd(), 'bin', name);
  if (fs.existsSync(bundled)) {
    try {
      const ver = execSync(`"${bundled}" --version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      if (ver.trim()) return bundled;
    } catch {}
  }
  try {
    const result = execSync(`which ${name}`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
    if (result) return result;
  } catch {}
  return null;
}

export async function GET() {
  const results: HealthCheckResult[] = [];
  const startTime = Date.now();

  // 1. Check FFmpeg (try auto-download if missing)
  try {
    const ffmpegStart = Date.now();

    let ffmpegPath = findBinary('ffmpeg');
    let ffprobePath = findBinary('ffprobe');

    // If not found, try runtime download
    if (!ffmpegPath || !ffprobePath) {
      console.log('[health] FFmpeg not found, attempting auto-download...');
      const downloaded = await ensureFFmpeg();
      if (downloaded) {
        ffmpegPath = findBinary('ffmpeg');
        ffprobePath = findBinary('ffprobe');
      }
    }

    if (ffmpegPath && ffprobePath) {
      let ffmpegVer = '';
      let ffprobeVer = '';
      try {
        ffmpegVer = execSync(`"${ffmpegPath}" -version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).split('\n')[0];
      } catch {}
      try {
        ffprobeVer = execSync(`"${ffprobePath}" -version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).split('\n')[0];
      } catch {}
      results.push({
        service: 'FFmpeg',
        status: 'ok',
        message: 'FFmpeg & FFprobe available',
        latency: Date.now() - ffmpegStart,
        details: `${ffmpegVer} | ${ffprobeVer}`,
      });
    } else {
      // Read setup log for diagnostics
      let setupLog = '';
      const logPath = path.join(process.cwd(), 'bin', 'setup.log');
      if (fs.existsSync(logPath)) {
        try {
          setupLog = fs.readFileSync(logPath, 'utf-8').slice(-500);
        } catch {}
      }
      results.push({
        service: 'FFmpeg',
        status: 'error',
        message: `FFmpeg not found — auto-download failed. Video processing unavailable.`,
        details: setupLog ? `Setup log (last 500 chars): ${setupLog}` : 'No setup log found.',
      });
    }
  } catch {
    results.push({
      service: 'FFmpeg',
      status: 'error',
      message: 'FFmpeg check failed — video processing will fail',
    });
  }

  // 2. Check yt-dlp
  try {
    const ytdlpStart = Date.now();
    const ytDlpPath = findBinary('yt-dlp');

    if (ytDlpPath) {
      const ytdlpVersion = execSync(`"${ytDlpPath}" --version`, {
        encoding: 'utf-8', timeout: 5000, stdio: 'pipe',
      }).trim();
      results.push({
        service: 'yt-dlp',
        status: 'ok',
        message: 'YouTube download available',
        latency: Date.now() - ytdlpStart,
        details: `v${ytdlpVersion} at ${ytDlpPath}`,
      });
    } else {
      results.push({
        service: 'yt-dlp',
        status: 'warning',
        message: 'yt-dlp not found — YouTube download unavailable. File upload still works.',
      });
    }
  } catch {
    results.push({
      service: 'yt-dlp',
      status: 'warning',
      message: 'yt-dlp check failed — YouTube download may be unavailable.',
    });
  }

  // 3. Check ASR (Speech-to-Text)
  try {
    const asrStart = Date.now();
    const zai = await ZAI.create();

    // Generate a tiny WAV (1 second of silence) to test ASR connectivity
    const sampleRate = 16000;
    const numSamples = sampleRate * 1;
    const buffer = Buffer.alloc(44 + numSamples * 2);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + numSamples * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(numSamples * 2, 40);

    const base64Audio = buffer.toString('base64');
    await zai.audio.asr.create({ file_base64: base64Audio });

    const latency = Date.now() - asrStart;
    results.push({
      service: 'ASR (Speech-to-Text)',
      status: 'ok',
      message: `Connected and working (${latency}ms)`,
      latency,
      details: 'Silent audio test passed — API responds correctly.',
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    results.push({
      service: 'ASR (Speech-to-Text)',
      status: 'error',
      message: `ASR API error: ${errMsg}`,
    });
  }

  // 4. Check LLM (AI Chat)
  try {
    const llmStart = Date.now();
    const zai = await ZAI.create();

    const llmResponse = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: 'You are a health check responder. Respond with exactly: OK',
        },
        {
          role: 'user',
          content: 'Health check. Reply with just "OK".',
        },
      ],
      thinking: { type: 'disabled' },
    });

    const latency = Date.now() - llmStart;
    const reply = llmResponse.choices[0]?.message?.content || '';

    results.push({
      service: 'LLM (AI Chat)',
      status: 'ok',
      message: `Connected and working (${latency}ms)`,
      latency,
      details: `Response: "${reply.slice(0, 80)}"`,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    results.push({
      service: 'LLM (AI Chat)',
      status: 'error',
      message: `LLM API error: ${errMsg}`,
    });
  }

  // 5. Check filesystem directories
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const outputsDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

    const uploadCount = fs.readdirSync(uploadsDir).length;
    const outputCount = fs.readdirSync(outputsDir).length;

    results.push({
      service: 'Storage',
      status: 'ok',
      message: 'Upload/output directories ready',
      details: `uploads: ${uploadCount} files, outputs: ${outputCount} files`,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    results.push({
      service: 'Storage',
      status: 'error',
      message: `Storage error: ${errMsg}`,
    });
  }

  const totalLatency = Date.now() - startTime;
  const allOk = results.every(r => r.status === 'ok');
  const hasError = results.some(r => r.status === 'error');

  return NextResponse.json({
    status: allOk ? 'healthy' : hasError ? 'unhealthy' : 'degraded',
    totalLatencyMs: totalLatency,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    checks: results,
  });
}
