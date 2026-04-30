import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import ZAI from 'z-ai-web-dev-sdk';

interface HealthCheckResult {
  service: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
  latency?: number;
  details?: string;
}

export async function GET() {
  const results: HealthCheckResult[] = [];
  const startTime = Date.now();

  // 1. Check FFmpeg
  try {
    const ffmpegStart = Date.now();
    const version = execSync('ffmpeg -version 2>&1 | head -1', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    const ffprobeVersion = execSync('ffprobe -version 2>&1 | head -1', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    results.push({
      service: 'FFmpeg',
      status: 'ok',
      message: 'FFmpeg & FFprobe available',
      latency: Date.now() - ffmpegStart,
      details: `${version} | ${ffprobeVersion}`,
    });
  } catch {
    results.push({
      service: 'FFmpeg',
      status: 'error',
      message: 'FFmpeg not found — video processing will fail',
    });
  }

  // 2. Check yt-dlp
  try {
    const ytdlpStart = Date.now();
    const candidates = [
      path.join(process.cwd(), 'bin', 'yt-dlp'),
      '/home/z/.venv/bin/yt-dlp',
      '/home/z/.local/bin/yt-dlp',
      '/usr/local/bin/yt-dlp',
      '/usr/bin/yt-dlp',
    ];

    let ytDlpPath: string | null = null;
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          execSync(`"${candidate}" --version`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
          ytDlpPath = candidate;
          break;
        }
      } catch {}
    }

    if (!ytDlpPath) {
      try {
        const whichResult = execSync('which yt-dlp', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
        if (whichResult) ytDlpPath = whichResult;
      } catch {}
    }

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

    // Generate a tiny sine wave WAV (1 second of silence) to test ASR connectivity
    const sampleRate = 16000;
    const numSamples = sampleRate * 1;
    const buffer = Buffer.alloc(44 + numSamples * 2);

    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + numSamples * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(numSamples * 2, 40);

    const base64Audio = buffer.toString('base64');

    const asrResponse = await zai.audio.asr.create({
      file_base64: base64Audio,
    });

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
