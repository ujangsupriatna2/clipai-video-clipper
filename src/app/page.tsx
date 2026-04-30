import dynamic from 'next/dynamic';

const AppClient = dynamic(() => import('@/components/app-client'), {
  ssr: true,
  loading: () => <LoadingScreen />,
});

export default function Home() {
  return <AppClient />;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-amber-500/[0.03] blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] rounded-full bg-orange-500/[0.02] blur-[100px]" />
      </div>
      <main className="relative flex-1 flex flex-col items-center justify-center px-4">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border-4 border-amber-500/20 border-t-amber-500 animate-spin" />
          <h1 className="text-2xl font-bold text-zinc-100">Loading ClipAI...</h1>
        </div>
      </main>
      <footer className="border-t border-zinc-800/50 mt-auto px-4 py-4 text-center">
        <p className="text-xs text-zinc-500">Powered by Z.ai — AI Video Clipper & Subtitler</p>
      </footer>
    </div>
  );
}
