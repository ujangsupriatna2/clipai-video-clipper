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
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12, border: '4px solid rgba(245,158,11,0.2)',
        borderTopColor: '#f59e0b', animation: 'spin 1s linear infinite', marginBottom: 16
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Loading ClipAI...</h1>
    </div>
  );
}
