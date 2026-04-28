import { useSignalsStore } from '../../store/signals.store';
import type { Page } from '../../App';
import type { WsStatus } from '../../hooks/useWebSocket';
import type { AgentStatus } from '../../types';

const AGENT_NAMES = ['collector', 'analyst', 'bull', 'bear', 'strategist', 'risk', 'reporter'] as const;

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'portfolio', label: 'Portfolio', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'agents', label: 'Agents', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2' },
  { id: 'markets', label: 'Markets', icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
  { id: 'config', label: 'Config', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

const statusColor: Record<AgentStatus, string> = {
  idle: '#8892A4',
  running: '#FFB347',
  ok: '#00D4AA',
  error: '#FF4D6D',
};

const wsColors: Record<WsStatus, string> = {
  connecting: '#FFB347',
  connected: '#00D4AA',
  disconnected: '#8892A4',
  error: '#FF4D6D',
};

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  wsStatus: WsStatus;
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({ activePage, onNavigate, wsStatus, open }: SidebarProps) {
  const { agents } = useSignalsStore();

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => {}}
        />
      )}

      <aside
        className={`
          fixed md:relative z-30 md:z-auto h-full flex flex-col
          bg-bg-surface border-r border-border transition-all duration-300
          ${open ? 'w-[220px]' : 'w-0 md:w-[220px]'} overflow-hidden
        `}
        style={{ minWidth: open ? 220 : 0 }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border flex-shrink-0">
          <div
            className="w-5 h-5 flex-shrink-0"
            style={{
              background: '#00D4AA',
              animation: 'pulse2 2s ease-in-out infinite',
            }}
          />
          <span className="font-syne font-bold text-[18px] tracking-tight text-accent-green whitespace-nowrap">
            NEXUS TRADE
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`
                w-full flex items-center gap-3 px-4 py-3 text-sm transition-all duration-150 whitespace-nowrap
                ${activePage === item.id
                  ? 'border-l-2 border-accent-green bg-bg-elevated text-text-primary'
                  : 'border-l-2 border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                }
              `}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Agent indicators */}
        <div className="border-t border-border px-4 py-3 space-y-1.5 flex-shrink-0">
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Agents</p>
          {AGENT_NAMES.map((name) => {
            const agent = agents[name];
            const color = statusColor[agent.status];
            const isRunning = agent.status === 'running';
            return (
              <div key={name} className="flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: color,
                    animation: isRunning ? 'pulse2 1s ease-in-out infinite' : undefined,
                  }}
                />
                <span className="text-[11px] text-text-secondary font-mono capitalize flex-1 whitespace-nowrap">
                  {name}
                </span>
                <span className="text-[10px]" style={{ color }}>
                  {agent.status}
                </span>
              </div>
            );
          })}
        </div>

        {/* WS Status */}
        <div className="border-t border-border px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: wsColors[wsStatus],
                animation: wsStatus === 'connected' ? 'blink 2s ease-in-out infinite' : undefined,
              }}
            />
            <span className="text-[11px] font-mono" style={{ color: wsColors[wsStatus] }}>
              {wsStatus === 'connected' ? '● LIVE' : wsStatus.toUpperCase()}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
