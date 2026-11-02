import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { TopHeaderActions } from './TopHeaderActions';
import { Sidebar } from './Sidebar/Sidebar';
import { SystemPulse } from './SystemPulse';
import { useAppStore } from '../lib/store';
import { checkHealth } from '../lib/api';

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = true;

    const check = async () => {
      const ok = await checkHealth();
      if (!active) return;
      setApiReachable(ok);
      // If backend is unreachable, poll every 3 seconds to auto-dismiss banner quickly upon recovery.
      // If healthy, poll every 30 seconds.
      timer = setTimeout(check, ok ? 30000 : 3000);
    };

    check();
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);

    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleManualRetry = async () => {
    setIsRetrying(true);
    try {
      const ok = await checkHealth();
      setApiReachable(ok);
    } finally {
      setIsRetrying(false);
    }
  };

  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full w-full overflow-hidden relative" style={{ paddingTop: '3px' }}>
      <div className="hud-backdrop" aria-hidden="true" />
      <SystemPulse apiReachable={apiReachable} />
      <TopHeaderActions />

      {/* Health check banner */}
      {apiReachable === false && (
        <div
          className="flex items-center gap-3 px-4 py-2 text-sm shrink-0"
          style={{
            background: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--color-error) 15%, transparent)',
            color: 'var(--color-text)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
            style={{ background: 'var(--color-error)' }}
          />
          <span>Cannot reach OpenJarvis backend</span>
          <div className="flex items-center gap-3 ml-auto shrink-0">
            <button
              onClick={handleManualRetry}
              disabled={isRetrying}
              className="text-sm font-medium underline cursor-pointer disabled:opacity-50"
              style={{ color: 'var(--color-accent)' }}
            >
              {isRetrying ? 'Retrying...' : 'Retry'}
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="text-sm underline cursor-pointer"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Change URL
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative z-10">
        <Sidebar />
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/40 md:hidden"
            onClick={() => useAppStore.getState().setSidebarOpen(false)}
          />
        )}
        <main className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden" style={{ background: 'transparent' }}>
          <div className="flex-1 flex flex-col min-w-0 min-h-0 relative z-[2]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
