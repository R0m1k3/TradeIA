import type { AgentState, AgentStatus as AgentStatusType } from '../../types';

const STATUS_COLOR: Record<AgentStatusType, string> = {
  idle: '#8892A4',
  running: '#FFB347',
  ok: '#00D4AA',
  error: '#FF4D6D',
};

const MODEL_MAP: Record<string, string> = {
  collector: 'LIGHT',
  analyst: 'MID',
  bull: 'MID',
  bear: 'MID',
  strategist: 'STRONG',
  risk: 'STRONG',
  reporter: 'LIGHT',
};

interface AgentStatusCardProps {
  name: string;
  state: AgentState;
  model: string;
}

export function AgentStatusCard({ name, state, model }: AgentStatusCardProps) {
  const color = STATUS_COLOR[state.status];
  const tier = MODEL_MAP[name] || 'MID';
  const tierColor = tier === 'STRONG' ? '#00D4AA' : tier === 'MID' ? '#4A9EFF' : '#8892A4';

  return (
    <div className="bg-bg-surface rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: color,
              animation: state.status === 'running' ? 'pulse2 0.8s ease-in-out infinite' : undefined,
            }}
          />
          <span className="font-syne font-bold text-sm capitalize text-text-primary">{name}</span>
        </div>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ color: tierColor, background: `${tierColor}15` }}
        >
          {tier}
        </span>
      </div>

      <div className="text-[10px] font-mono text-text-secondary truncate">{model}</div>

      <div className="flex items-center gap-4">
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider">Status</p>
          <p className="text-xs font-mono font-bold capitalize" style={{ color }}>{state.status}</p>
        </div>
        {state.durationMs && (
          <div>
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">Duration</p>
            <p className="text-xs font-mono text-text-primary">{state.durationMs}ms</p>
          </div>
        )}
        {state.tokensUsed && (
          <div>
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">Tokens</p>
            <p className="text-xs font-mono text-text-primary">{state.tokensUsed.toLocaleString()}</p>
          </div>
        )}
      </div>

      {state.lastRun && (
        <p className="text-[10px] text-text-secondary font-mono">
          {new Date(state.lastRun).toLocaleTimeString('en-US', { hour12: false })}
        </p>
      )}

      {state.error && (
        <div className="bg-accent-red/10 border border-accent-red/20 rounded p-2">
          <p className="text-[10px] text-accent-red font-mono break-all">{state.error}</p>
        </div>
      )}
    </div>
  );
}
