import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import ZAI from 'z-ai-web-dev-sdk';
import {
  getVideoDuration,
  extractAudio,
  cutVideo,
  generateSRT,
  burnSubtitles,
} from '@/lib/video-utils';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

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
        // Parse form data
        const formData = await req.formData();
        const videoFile = formData.get('video') as File | null;

        if (!videoFile) {
          send({ step: 'error' as const, message: 'No video file provided', error: 'No video file uploaded.' });
          controller.close();
          return;
        }

        // Generate job ID and create directories
        jobId = randomUUID().replace(/-/g, '').slice(0, 12);
        uploadDir = path.join(UPLOADS_DIR, jobId);
        outputDir = path.join(OUTPUTS_DIR, jobId);

        fs.mkdirSync(uploadDir, { recursive: true });
        fs.mkdirSync(outputDir, { recursive: true });

        // Save uploaded video
        send({
          step: 'uploading',
          message: 'Saving uploaded video...',
          progress: 10,
          jobId,
        });

        const videoPath = path.join(uploadDir, `original${path.extname(videoFile.name) || '.mp4'}`);
        const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
        fs.writeFileSync(videoPath, videoBuffer);

        // Get video duration
        const videoDuration = getVideoDuration(videoPath);
        send({
          step: 'uploading',
          message: `Video saved (${videoDuration.toFixed(1)}s). Extracting audio...`,
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

        // Step 3: Transcribe audio
        send({
          step: 'transcribing',
          message: 'AI is listening and converting speech to text...',
          progress: 40,
        });

        const zai = await ZAI.create();
        const audioBuffer = fs.readFileSync(audioPath);
        const base64Audio = audioBuffer.toString('base64');

        const asrResponse = await zai.audio.asr.create({
          file_base64: base64Audio,
        });

        const transcript = asrResponse.text || '';

        if (!transcript.trim()) {
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
          thinking: { type: 'enabled' },
        });

        const llmContent = llmResponse.choices[0]?.message?.content || '';

        // Parse the LLM response - try to extract JSON
        let segments: Array<{
          start_time: number;
          end_time: number;
          title: string;
          description: string;
          subtitle_text: string;
        }> = [];

        try {
          // Try to parse directly
          const parsed = JSON.parse(llmContent);
          segments = parsed.segments || [];
        } catch {
          // Try to extract JSON from markdown code block
          const jsonMatch = llmContent.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[1]);
              segments = parsed.segments || [];
            } catch {
              // Last resort: try to find JSON object
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
          // Fallback: create a single clip from the whole video
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
        })).filter(seg => seg.end_time - seg.start_time >= 3); // At least 3 seconds

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

          // Cut video segment
          const rawClipPath = path.join(outputDir, `clip-${i + 1}-raw.mp4`);
          cutVideo(videoPath, rawClipPath, seg.start_time, seg.end_time);

          // Generate SRT subtitle
          const srtPath = path.join(outputDir, `clip-${i + 1}.srt`);
          generateSRT(seg.subtitle_text, clipDuration, srtPath);

          // Burn subtitles into clip
          const finalClipPath = path.join(outputDir, `clip-${i + 1}.mp4`);
          burnSubtitles(rawClipPath, srtPath, finalClipPath);

          // Clean up raw clip
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

        // Clean up: remove upload directory to save space
        try { fs.rmSync(uploadDir, { recursive: true }); } catch {}

        // Send final result
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

        // Clean up on error
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
