import { useState } from 'react';
import { useSignalsStore } from '../store/signals.store';
import { useConfigStore } from '../store/config.store';
import { AgentStatusCard } from '../components/agents/AgentStatus';
import { ReasoningLog } from '../components/agents/ReasoningLog';
import { DebateViewer } from '../components/agents/DebateViewer';
import type { AgentStates } from '../types';

const MODEL_TIERS: Record<keyof AgentStates, 'LIGHT' | 'MID' | 'STRONG'> = {
  collector: 'LIGHT',
  analyst: 'MID',
  bull: 'MID',
  bear: 'MID',
  strategist: 'STRONG',
  risk: 'STRONG',
  reporter: 'LIGHT',
};

export function Agents() {
  const { agents, signals, debates } = useSignalsStore();
  const { config } = useConfigStore();
  const [selectedDebateTicker, setSelectedDebateTicker] = useState<string | null>(null);

  const modelMap: Record<string, string> = {
    LIGHT: config.model_light || 'anthropic/claude-haiku-4-5',
    MID: config.model_mid || 'anthropic/claude-sonnet-4-5',
    STRONG: config.model_strong || 'anthropic/claude-opus-4',
  };

  const selectedDebate = debates.find((d) => d.ticker === selectedDebateTicker) || debates[0];

  return (
    <div className="space-y-4 max-w-[1600px]">
      {/* Agent status grid */}
      <div>
        <h2 className="font-syne font-bold text-base text-text-primary mb-3">Agent Pipeline</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {(Object.entries(agents) as [keyof AgentStates, AgentStates[keyof AgentStates]][]).map(([name, state]) => (
            <AgentStatusCard
              key={name}
              name={name}
              state={state}
              model={modelMap[MODEL_TIERS[name]]}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Reasoning log */}
        <div className="bg-bg-surface rounded-lg border border-border">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-syne font-bold text-sm text-text-primary">Activity Log</h3>
          </div>
          <div className="p-3">
            <ReasoningLog agents={agents} />
          </div>
        </div>

        {/* Debate viewer */}
        <div className="xl:col-span-2 space-y-3">
          <div className="bg-bg-surface rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-syne font-bold text-sm text-text-primary">Bull vs Bear Debate</h3>
              {debates.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {debates.map((d) => (
                    <button
                      key={d.ticker}
                      onClick={() => setSelectedDebateTicker(d.ticker)}
                      className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${
                        (selectedDebateTicker || debates[0]?.ticker) === d.ticker
                          ? 'border-accent-green text-accent-green bg-accent-green/10'
                          : 'border-border text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {d.ticker}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-3">
              {selectedDebate ? (
                <DebateViewer debate={selectedDebate} />
              ) : (
                <div className="flex items-center justify-center h-48 text-text-secondary text-sm">
                  No debate data yet — awaiting agent cycle
                </div>
              )}
            </div>
          </div>

          {/* Signals summary */}
          {signals.length > 0 && (
            <div className="bg-bg-surface rounded-lg border border-border">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="font-syne font-bold text-sm text-text-primary">Current Signals</h3>
              </div>
              <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {signals.map((s) => (
                  <div key={s.ticker} className="flex items-center gap-2 px-3 py-2 bg-bg-elevated rounded border border-border">
                    <span className="font-mono font-bold text-xs text-text-primary">{s.ticker}</span>
                    <span
                      className="text-[10px] font-mono ml-auto"
                      style={{ color: s.signal === 'BUY' ? '#00D4AA' : s.signal === 'SELL' ? '#FF4D6D' : '#FFB347' }}
                    >
                      {s.signal}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
