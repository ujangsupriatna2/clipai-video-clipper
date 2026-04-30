export default function Home() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ClipAI Test</title>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #0a0a0a; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
          .card { background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 48px; text-align: center; }
          h1 { font-size: 48px; font-weight: 800; background: linear-gradient(to right, #f59e0b, #ef4444); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 16px; }
          p { color: #a1a1aa; font-size: 16px; }
          .badge { display: inline-block; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); color: #fbbf24; padding: 4px 12px; border-radius: 20px; font-size: 12px; margin-bottom: 24px; }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className="badge">AI-Powered Video Processing</div>
          <h1>ClipAI</h1>
          <p>If you see this, the preview works!</p>
        </div>
      </body>
    </html>
  );
}
