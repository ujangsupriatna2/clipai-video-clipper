import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;

    if (!pathSegments || pathSegments.length < 2) {
      return NextResponse.json(
        { error: 'Invalid path. Expected: /serve/{jobId}/{filename}' },
        { status: 400 }
      );
    }

    const [jobId, ...filenameParts] = pathSegments;
    const filename = filenameParts.join('/');
    const filePath = path.join(OUTPUTS_DIR, jobId, filename);

    // Security: prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    const resolvedOutputs = path.resolve(OUTPUTS_DIR);
    if (!resolvedPath.startsWith(resolvedOutputs)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Check file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Read file and determine content type
    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.srt': 'text/plain',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.wav': 'audio/wav',
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600',
        // For video files, support range requests
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error: unknown) {
    console.error('File serve error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to serve file' },
      { status: 500 }
    );
  }
}
