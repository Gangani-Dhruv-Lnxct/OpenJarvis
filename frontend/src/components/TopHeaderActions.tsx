import { useLocation } from 'react-router';
import { LayoutDashboard, X } from 'lucide-react';
import { ApprovalBell } from './ApprovalBell';
import { useAppStore } from '../lib/store';

export function TopHeaderActions() {
  const location = useLocation();
  const isChat = location.pathname === '/';
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);
  const toggleSystemPanel = useAppStore((s) => s.toggleSystemPanel);

  return (
    <div className="fixed top-2.5 right-3.5 z-40 flex items-center gap-2 pointer-events-auto">
      {/* Agent Approvals Bell */}
      <ApprovalBell />

      {/* Dashboard / Telemetry Panel Toggle (Chat view only) */}
      {isChat && (
        <button
          onClick={toggleSystemPanel}
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer border shadow-xs group"
          style={{
            background: systemPanelOpen
              ? 'color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-secondary))'
              : 'var(--color-bg-secondary)',
            borderColor: systemPanelOpen
              ? 'color-mix(in srgb, var(--color-accent) 40%, var(--color-border))'
              : 'var(--color-border)',
            color: systemPanelOpen
              ? 'var(--color-accent)'
              : 'var(--color-text-secondary)',
          }}
          title={systemPanelOpen ? 'Close system dashboard (Ctrl+I)' : 'Open system dashboard (Ctrl+I)'}
          aria-label={systemPanelOpen ? 'Close system dashboard' : 'Open system dashboard'}
        >
          {systemPanelOpen ? (
            <>
              <X size={15} className="transition-transform group-hover:scale-110" />
              <span className="hidden sm:inline">Close</span>
            </>
          ) : (
            <>
              <LayoutDashboard size={15} style={{ color: 'var(--color-accent)' }} className="transition-transform group-hover:scale-110" />
              <span className="hidden sm:inline">Dashboard</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
