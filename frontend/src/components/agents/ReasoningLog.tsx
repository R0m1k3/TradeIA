import type { AgentStates, AgentStatus } from '../../types';

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: '#8892A4',
  running: '#FFB347',
  ok: '#00D4AA',
  error: '#FF4D6D',
};

const AGENT_LABELS: Record<string, string> = {
  collector: 'Data Collector',
  analyst: 'Technical Analyst',
  bull: 'Bull Researcher',
  bear: 'Bear Researcher',
  strategist: 'Strategist',
  risk: 'Risk Manager',
  reporter: 'Reporter',
};

interface ReasoningLogProps {
  agents: AgentStates;
}

export function ReasoningLog({ agents }: ReasoningLogProps) {
  return (
    <div className="space-y-2">
      {(Object.entries(agents) as [keyof AgentStates, AgentStates[keyof AgentStates]][]).map(([key, state]) => {
        const color = STATUS_COLOR[state.status];
        const isRunning = state.status === 'running';

        return (
          <div
            key={key}
            className="flex items-start gap-3 px-3 py-2.5 rounded border border-border bg-bg-elevated"
          >
            <div className="flex-shrink-0 mt-0.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  background: color,
                  animation: isRunning ? 'pulse2 0.8s ease-in-out infinite' : undefined,
                }}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-medium text-text-primary">
                  {AGENT_LABELS[key] || key}
                </span>
                <span className="text-[10px] font-mono" style={{ color }}>
                  {state.status.toUpperCase()}
                </span>
              </div>

              {state.lastRun && (
                <p className="text-[10px] text-text-secondary font-mono mt-0.5">
                  Last run: {new Date(state.lastRun).toLocaleTimeString('en-US', { hour12: false })}
                  {state.durationMs && ` · ${state.durationMs}ms`}
                  {state.tokensUsed && ` · ${state.tokensUsed.toLocaleString()} tokens`}
                </p>
              )}

              {state.error && (
                <p className="text-[10px] text-accent-red font-mono mt-0.5 truncate">{state.error}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
