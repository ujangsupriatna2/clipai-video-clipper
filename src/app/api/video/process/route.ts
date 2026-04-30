import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import ZAI from 'z-ai-web-dev-sdk';
import {
  getVideoDuration,
  extractAudio,
  splitAudio,
  cutVideo,
  generateSRT,
  burnSubtitles,
  downloadYouTubeVideo,
  ensureFFmpeg,
} from '@/lib/video-utils';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

// Ensure directories exist on module load
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let jobId = '';
      let uploadDir = '';
      let outputDir = '';

      try {
        // Determine input type: file upload or YouTube URL
        const contentType = req.headers.get('content-type') || '';
        let videoPath = '';

        // Check if it's a JSON body with YouTube URL
        if (contentType.includes('application/json')) {
          const body = await req.json();
          const youtubeUrl = body.youtubeUrl || body.url;

          if (!youtubeUrl) {
            send({ step: 'error' as const, message: 'No YouTube URL provided', error: 'Please provide a YouTube URL.' });
            controller.close();
            return;
          }

          jobId = randomUUID().replace(/-/g, '').slice(0, 12);
          uploadDir = path.join(UPLOADS_DIR, jobId);
          outputDir = path.join(OUTPUTS_DIR, jobId);
          fs.mkdirSync(uploadDir, { recursive: true });
          fs.mkdirSync(outputDir, { recursive: true });

          send({
            step: 'uploading',
            message: 'Downloading YouTube video...',
            progress: 5,
            jobId,
          });

          // Download YouTube video
          const ytResult = await downloadYouTubeVideo(
            youtubeUrl,
            uploadDir,
            (percent) => {
              send({
                step: 'uploading',
                message: `Downloading YouTube video... ${Math.round(percent)}%`,
                progress: 5 + (percent / 100) * 15,
              });
            }
          );

          videoPath = ytResult.videoPath;

          send({
            step: 'uploading',
            message: `Downloaded "${ytResult.title}" (${ytResult.duration.toFixed(1)}s). Extracting audio...`,
            progress: 20,
          });

        } else {
          // File upload
          const formData = await req.formData();
          const videoFile = formData.get('video') as File | null;

          if (!videoFile) {
            send({ step: 'error' as const, message: 'No video file provided', error: 'No video file uploaded.' });
            controller.close();
            return;
          }

          jobId = randomUUID().replace(/-/g, '').slice(0, 12);
          uploadDir = path.join(UPLOADS_DIR, jobId);
          outputDir = path.join(OUTPUTS_DIR, jobId);
          fs.mkdirSync(uploadDir, { recursive: true });
          fs.mkdirSync(outputDir, { recursive: true });

          send({
            step: 'uploading',
            message: 'Saving uploaded video...',
            progress: 10,
            jobId,
          });

          videoPath = path.join(uploadDir, `original${path.extname(videoFile.name) || '.mp4'}`);
          const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
          fs.writeFileSync(videoPath, videoBuffer);
        }

        // Ensure FFmpeg is available (download at runtime if missing)
        send({
          step: 'uploading',
          message: 'Checking video processing tools...',
          progress: 15,
        });

        const ffmpegReady = await ensureFFmpeg();
        if (!ffmpegReady) {
          send({
            step: 'error' as const,
            message: 'FFmpeg is not available on this server.',
            error: 'Video processing requires FFmpeg which is not installed. Please contact the administrator.',
          });
          controller.close();
          return;
        }

        // Get video duration
        const videoDuration = getVideoDuration(videoPath);

        send({
          step: 'uploading',
          message: `Video ready (${videoDuration.toFixed(1)}s). Extracting audio...`,
          progress: 20,
        });

        // Step 2: Extract audio
        send({
          step: 'extracting',
          message: 'Extracting audio track from video...',
          progress: 25,
        });

        const audioPath = path.join(uploadDir, 'audio.wav');
        extractAudio(videoPath, audioPath);

        send({
          step: 'extracting',
          message: 'Audio extracted. Transcribing speech...',
          progress: 35,
        });

        // Step 3: Transcribe audio (split into 28s chunks if needed)
        send({
          step: 'transcribing',
          message: 'AI is listening and converting speech to text...',
          progress: 35,
        });

        const zai = await ZAI.create();

        // Split audio into chunks (API limit is 30s)
        const audioChunks = splitAudio(audioPath, uploadDir, 28);
        const transcriptParts: string[] = [];

        for (let i = 0; i < audioChunks.length; i++) {
          const chunkProgress = 35 + ((i + 1) / audioChunks.length) * 20;
          send({
            step: 'transcribing',
            message: audioChunks.length > 1
              ? `Transcribing part ${i + 1} of ${audioChunks.length}...`
              : 'AI is listening and converting speech to text...',
            progress: chunkProgress,
          });

          const chunkBuffer = fs.readFileSync(audioChunks[i]);
          const base64Chunk = chunkBuffer.toString('base64');

          try {
            const asrResponse = await zai.audio.asr.create({
              file_base64: base64Chunk,
            });
            const partText = (asrResponse.text || '').trim();
            if (partText) transcriptParts.push(partText);
          } catch (asrErr) {
            console.error(`[ASR] Chunk ${i + 1} failed:`, asrErr);
            // Continue with other chunks even if one fails
          }

          // Clean up chunk file (if it was a split chunk, not the original)
          if (audioChunks[i] !== audioPath) {
            try { fs.unlinkSync(audioChunks[i]); } catch {}
          }
        }

        const transcript = transcriptParts.join(' ').trim();

        if (!transcript) {
          send({
            step: 'error',
            message: 'No speech detected in the video.',
            error: 'Could not detect any speech in the video. Please upload a video with clear speech.',
          });
          controller.close();
          return;
        }

        send({
          step: 'transcribing',
          message: `Transcription complete (${transcript.split(/\s+/).length} words). Analyzing content...`,
          progress: 55,
          transcript,
        });

        // Step 4: Analyze transcript with LLM
        send({
          step: 'analyzing',
          message: 'AI is finding the most engaging moments...',
          progress: 60,
        });

        const llmResponse = await zai.chat.completions.create({
          messages: [
            {
              role: 'assistant',
              content: `You are an expert video content analyst. You identify the most engaging segments of videos for social media clips (TikTok, Reels, Shorts). You always respond with valid JSON only, no markdown, no code blocks.`
            },
            {
              role: 'user',
              content: `Given the following transcript from a video that is ${videoDuration.toFixed(1)} seconds long, identify the 3 to 5 most engaging, interesting, or viral-worthy segments that would make great short clips.

TRANSCRIPT:
"""
${transcript}
"""

INSTRUCTIONS:
- Each clip should be 15-60 seconds long
- Clips should have natural start/end points (complete sentences or thoughts)
- Choose the most engaging moments (funny, surprising, informative, emotional, quotable)
- Ensure clips don't overlap by at least 2 seconds
- Cover different parts of the video if possible
- "start_time" and "end_time" are in seconds, must be within [0, ${videoDuration.toFixed(1)}]
- Provide the exact subtitle text from the transcript for each clip

Respond with valid JSON only (no markdown, no code blocks):
{
  "segments": [
    {
      "start_time": 10.0,
      "end_time": 40.0,
      "title": "Catchy Clip Title",
      "description": "Why this segment is interesting",
      "subtitle_text": "The exact text from the transcript for this segment..."
    }
  ]
}

If the video is very short (under 60 seconds), just return 1-2 segments covering the most important parts.`
            },
          ],
          thinking: { type: 'disabled' },
        });

        const llmContent = llmResponse.choices[0]?.message?.content || '';

        // Parse the LLM response
        let segments: Array<{
          start_time: number;
          end_time: number;
          title: string;
          description: string;
          subtitle_text: string;
        }> = [];

        try {
          const parsed = JSON.parse(llmContent);
          segments = parsed.segments || [];
        } catch {
          const jsonMatch = llmContent.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[1]);
              segments = parsed.segments || [];
            } catch {
              const objMatch = llmContent.match(/\{[\s\S]*"segments"[\s\S]*\}/);
              if (objMatch) {
                try {
                  const parsed = JSON.parse(objMatch[0]);
                  segments = parsed.segments || [];
                } catch {}
              }
            }
          }
        }

        if (segments.length === 0) {
          segments = [{
            start_time: 0,
            end_time: Math.min(videoDuration, 60),
            title: 'Full Video Clip',
            description: 'The entire video as a single clip.',
            subtitle_text: transcript.slice(0, 500),
          }];
        }

        // Validate and clamp segments
        segments = segments.map(seg => ({
          ...seg,
          start_time: Math.max(0, seg.start_time),
          end_time: Math.min(videoDuration, seg.end_time),
        })).filter(seg => seg.end_time - seg.start_time >= 3);

        if (segments.length === 0) {
          send({
            step: 'error',
            message: 'Could not identify valid clip segments.',
            error: 'No valid clip segments could be identified from the video.',
          });
          controller.close();
          return;
        }

        send({
          step: 'analyzing',
          message: `Found ${segments.length} engaging segments. Generating clips...`,
          progress: 70,
        });

        // Step 5: Generate clips with subtitles
        const clips: Array<{
          index: number;
          filename: string;
          title: string;
          description: string;
          startTime: number;
          endTime: number;
          subtitle: string;
          duration: number;
        }> = [];

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const progressBase = 70 + (i / segments.length) * 25;

          send({
            step: 'generating',
            message: `Creating clip ${i + 1} of ${segments.length}: "${seg.title}"...`,
            progress: progressBase,
          });

          const clipDuration = seg.end_time - seg.start_time;

          const rawClipPath = path.join(outputDir, `clip-${i + 1}-raw.mp4`);
          cutVideo(videoPath, rawClipPath, seg.start_time, seg.end_time);

          const srtPath = path.join(outputDir, `clip-${i + 1}.srt`);
          generateSRT(seg.subtitle_text, clipDuration, srtPath);

          const finalClipPath = path.join(outputDir, `clip-${i + 1}.mp4`);
          burnSubtitles(rawClipPath, srtPath, finalClipPath);

          try { fs.unlinkSync(rawClipPath); } catch {}

          clips.push({
            index: i,
            filename: `clip-${i + 1}.mp4`,
            title: seg.title,
            description: seg.description,
            startTime: seg.start_time,
            endTime: seg.end_time,
            subtitle: seg.subtitle_text,
            duration: clipDuration,
          });
        }

        // Clean up upload directory
        try { fs.rmSync(uploadDir, { recursive: true }); } catch {}

        send({
          step: 'done',
          message: `${clips.length} clips generated successfully!`,
          progress: 100,
          jobId,
          clips,
          transcript,
        });

      } catch (error: unknown) {
        console.error('Video processing error:', error);

        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred during processing.';

        send({
          step: 'error',
          message: errorMessage,
          error: errorMessage,
        });

        if (uploadDir && fs.existsSync(uploadDir)) {
          try { fs.rmSync(uploadDir, { recursive: true }); } catch {}
        }
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
