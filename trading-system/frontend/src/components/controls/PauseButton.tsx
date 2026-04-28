import { useState } from 'react';
import { useConfigStore } from '../../store/config.store';

const API = import.meta.env.VITE_API_URL || '/api';

export function PauseButton() {
  const { paused, setPaused } = useConfigStore();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    const action = paused ? 'resume' : 'pause';
    const password = prompt('Admin password:');
    if (!password) { setLoading(false); return; }

    try {
      const res = await fetch(`${API}/override/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`:${password}`)}`,
        },
      });
      if (res.ok) setPaused(!paused);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold border transition-colors
        ${paused
          ? 'bg-accent-green/10 border-accent-green text-accent-green hover:bg-accent-green/20'
          : 'bg-accent-red/10 border-accent-red/50 text-accent-red hover:bg-accent-red/20'
        }
        ${loading ? 'opacity-50 cursor-wait' : ''}
      `}
    >
      {paused ? (
        <>
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
          </svg>
          RESUME
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          PAUSE
        </>
      )}
    </button>
  );
}
