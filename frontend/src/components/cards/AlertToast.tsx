import { useEffect } from 'react';
import { useSignalsStore } from '../../store/signals.store';
import type { AlertItem } from '../../types';

const LEVEL_STYLES: Record<string, { border: string; text: string; icon: string }> = {
  info: { border: 'var(--info)', text: 'var(--info)', icon: 'ℹ' },
  warning: { border: 'var(--warn)', text: 'var(--warn)', icon: '⚠' },
  critical: { border: 'var(--danger)', text: 'var(--danger)', icon: '🔴' },
};

function Toast({ alert, onDismiss }: { alert: AlertItem; onDismiss: (id: string) => void }) {
  const style = LEVEL_STYLES[alert.level] || LEVEL_STYLES.info;

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(alert.id), 5000);
    return () => clearTimeout(timer);
  }, [alert.id, onDismiss]);

  return (
    <div
      className="card"
      style={{
        width: 288,
        cursor: 'pointer',
        borderColor: style.border,
        animation: 'in 0.3s ease',
      }}
      onClick={() => onDismiss(alert.id)}
    >
      <div className="flex between center" style={{ padding: '10px 14px' }}>
        <span className="mono" style={{ fontSize: 11, color: style.text, fontWeight: 600, textTransform: 'uppercase' }}>
          {style.icon} {alert.level}
          {alert.ticker && ` · ${alert.ticker}`}
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
          {new Date(alert.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p style={{ padding: '0 14px 12px', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{alert.message}</p>
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
