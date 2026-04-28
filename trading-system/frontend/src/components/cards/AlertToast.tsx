import { useEffect } from 'react';
import { useSignalsStore } from '../../store/signals.store';
import type { AlertItem } from '../../types';

const LEVEL_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  info: { bg: '#4A9EFF10', border: '#4A9EFF', text: '#4A9EFF', icon: 'ℹ' },
  warning: { bg: '#FFB34710', border: '#FFB347', text: '#FFB347', icon: '⚠' },
  critical: { bg: '#FF4D6D10', border: '#FF4D6D', text: '#FF4D6D', icon: '🔴' },
};

function Toast({ alert, onDismiss }: { alert: AlertItem; onDismiss: (id: string) => void }) {
  const style = LEVEL_STYLES[alert.level] || LEVEL_STYLES.info;

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(alert.id), 5000);
    return () => clearTimeout(timer);
  }, [alert.id, onDismiss]);

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg animate-slide-in w-72 cursor-pointer"
      style={{ background: '#111827', borderColor: style.border }}
      onClick={() => onDismiss(alert.id)}
    >
      <span className="text-sm flex-shrink-0" style={{ color: style.text }}>
        {style.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: style.text }}>
            {alert.level}
            {alert.ticker && ` · ${alert.ticker}`}
          </span>
          <span className="text-[10px] text-text-secondary font-mono flex-shrink-0">
            {new Date(alert.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className="text-[12px] text-text-primary mt-0.5 leading-snug">{alert.message}</p>
      </div>
    </div>
  );
}

export function AlertToast() {
  const { alerts, removeAlert } = useSignalsStore();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      {alerts.slice(-5).map((alert) => (
        <Toast key={alert.id} alert={alert} onDismiss={removeAlert} />
      ))}
    </div>
  );
}
