import { useEffect, useRef, useState } from 'react';
import { useConfigStore } from '../store/config.store';

const API = import.meta.env.VITE_API_URL || '/api';

function Help({ tip }: { tip: string }) {
  return <span className="card-h-help" data-tip={tip}>i</span>;
}

function ApiKeyInput({
  label,
  configured,
  placeholder,
  onSave,
}: {
  label: string;
  configured: boolean;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const isSet = configured && !editing;

  return (
    <div style={{ marginBottom: 12 }}>
      <label className="label">{label}</label>
      <input
        type="password"
        placeholder={isSet ? 'API key is set' : placeholder}
        value={isSet ? '' : value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => { setEditing(true); setValue(''); }}
        onBlur={() => {
          setEditing(false);
          if (value.trim()) onSave(value.trim());
          setValue('');
        }}
        className="input"
      />
    </div>
  );
}

export function Config() {
  const { config, secretsConfigured, fetchConfig, saveConfig, saveSecret } = useConfigStore();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [risk, setRisk] = useState('balanced');
  const [llm, setLlm] = useState(config.llm_provider || 'openrouter');
  const [auto, setAuto] = useState(config.mock_broker === 'true');
  const [maxPos, setMaxPos] = useState(parseFloat(config.daily_loss_limit_pct || '3'));
  const [maxRisk, setMaxRisk] = useState(parseFloat(config.max_drawdown_pct || '10'));

  async function fetchModels() {
    setLoadingModels(true);
    try {
      const res = await fetch(`${API}/config/llm-models`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) setModels(data);
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setLoadingModels(false);
    }
  }

  useEffect(() => {
    fetchConfig().then(() => fetchModels());
  }, []);

  const prevProviderRef = useRef(config.llm_provider);
  useEffect(() => {
    if (config.llm_provider !== prevProviderRef.current) {
      prevProviderRef.current = config.llm_provider;
      fetchModels();
    }
  }, [config.llm_provider]);

  async function handleSave() {
    setSaving(true);
    const safeConfig: Partial<typeof config> = { ...config };
    if (!safeConfig.model_light) delete safeConfig.model_light;
    if (!safeConfig.model_mid) delete safeConfig.model_mid;
    if (!safeConfig.model_strong) delete safeConfig.model_strong;
    await saveConfig(safeConfig);
    await fetchModels();
    setSaving(false);
  }

  async function testLLM() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/config/test-llm`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setTestResult(`✓ ${data.message} — ${data.provider}/${data.model}`);
      } else {
        setTestResult(`✗ ${data.message}`);
      }
    } catch {
      setTestResult('✗ Connection failed');
    }
    setTesting(false);
  }

  return (
    <div className="page">
      <div className="flex between center" style={{ marginBottom: 22 }}>
        <div>
          <h1 className="h1">Configuration</h1>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 6 }}>
            Ajustez la stratégie, les agents et les paramètres système.
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Strategy */}
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              Stratégie de trading <Help tip="Définit le profil de risque global et l'agressivité des agents." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <label className="label">Profil</label>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
              {[
                ['prudent', 'Prudent', '+8% / -4%'],
                ['balanced', 'Équilibré', '+18% / -9%'],
                ['dynamic', 'Dynamique', '+32% / -18%'],
              ].map(([k, l, t]) => (
                <button
                  key={k}
                  onClick={() => setRisk(k)}
                  style={{
                    padding: 12, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                    border: '1.5px solid', borderColor: risk === k ? 'var(--accent)' : 'var(--rule)',
                    background: risk === k ? 'var(--accent-soft)' : 'var(--bg-elev-2)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: risk === k ? 'var(--accent)' : 'var(--ink)' }}>{l}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t}</div>
                </button>
              ))}
            </div>

            <label className="label">Univers d'actifs</label>
            <select className="select" defaultValue="us" style={{ marginBottom: 16 }}>
              <option value="us">Actions US (S&P 500)</option>
              <option value="eu">Actions Europe (STOXX 600)</option>
              <option value="crypto">Crypto majeures</option>
              <option value="mix">Mix multi-asset</option>
            </select>

            <label className="label">Marchés autorisés</label>
            <div className="flex wrap gap-2" style={{ marginBottom: 20 }}>
              {['Actions', 'Crypto', 'Forex', 'Or', 'Pétrole', 'Indices'].map((m, i) => (
                <button
                  key={m}
                  style={{
                    padding: '6px 12px', fontSize: 12, fontFamily: 'var(--mono)',
                    border: '1px solid', borderColor: i < 4 ? 'var(--accent)' : 'var(--rule)',
                    background: i < 4 ? 'var(--accent-soft)' : 'transparent',
                    color: i < 4 ? 'var(--accent)' : 'var(--ink-3)',
                    borderRadius: 999, cursor: 'pointer',
                  }}
                >
                  {i < 4 ? '✓ ' : ''}{m}
                </button>
              ))}
            </div>

            <button className="btn btn-primary" style={{ width: '100%' }}>Enregistrer la stratégie</button>
          </div>
        </div>

        {/* System */}
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              Système <Help tip="Paramètres techniques de fonctionnement." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <div className="flex between center" style={{ marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Mode automatique</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Les agents exécutent les trades sans validation manuelle</div>
              </div>
              <button
                onClick={() => {
                  setAuto(!auto);
                  saveConfig({ mock_broker: (!auto).toString() });
                }}
                style={{
                  width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: auto ? 'var(--accent)' : 'var(--bg-elev-2)',
                  position: 'relative', transition: 'all 0.2s',
                }}
              >
                <span style={{ position: 'absolute', top: 2, left: auto ? 20 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'all 0.2s' }} />
              </button>
            </div>

            <label className="label">Modèle LLM <Help tip="Le modèle d'IA utilisé par les agents pour raisonner." /></label>
            <select
              className="select"
              value={llm}
              onChange={(e) => {
                setLlm(e.target.value);
                saveConfig({ llm_provider: e.target.value });
              }}
              style={{ marginBottom: 18 }}
            >
              <option value="openrouter">Claude Sonnet 4.5 (recommandé)</option>
              <option value="gpt">GPT-4 Turbo</option>
              <option value="gemini">Gemini 2.5 Pro</option>
              <option value="ollama">Llama 3.3 70B (local)</option>
            </select>

            <label className="label">
              Capital max engagé : <span className="mono" style={{ color: 'var(--ink)', textTransform: 'none' }}>{maxPos}%</span>
            </label>
            <input
              type="range"
              min="2"
              max="20"
              value={maxPos}
              onChange={(e) => {
                setMaxPos(+e.target.value);
                saveConfig({ daily_loss_limit_pct: e.target.value });
              }}
              style={{ width: '100%', accentColor: 'var(--accent)', marginBottom: 18 }}
            />

            <label className="label">
              Risque max par trade : <span className="mono" style={{ color: 'var(--ink)', textTransform: 'none' }}>{maxRisk}%</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.5"
              value={maxRisk}
              onChange={(e) => {
                setMaxRisk(+e.target.value);
                saveConfig({ max_drawdown_pct: e.target.value });
              }}
              style={{ width: '100%', accentColor: 'var(--accent)', marginBottom: 20 }}
            />

            <div style={{ padding: 12, background: 'var(--warn-soft)', borderRadius: 6, fontSize: 12, color: 'var(--warn)', borderLeft: '3px solid var(--warn)' }}>
              ⚠ Au-delà de 3% par trade, le drawdown peut dépasser votre seuil cible.
            </div>
          </div>
        </div>

        {/* Backtest */}
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              Backtest <Help tip="Teste votre stratégie sur des données historiques." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label className="label">Du</label>
                <input className="input" type="date" defaultValue="2024-01-01" />
              </div>
              <div>
                <label className="label">Au</label>
                <input className="input" type="date" defaultValue="2026-04-28" />
              </div>
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label className="label">Capital initial</label>
                <input className="input" type="text" defaultValue="$10 000" />
              </div>
              <div>
                <label className="label">Frais par trade</label>
                <input className="input" type="text" defaultValue="0.02%" />
              </div>
            </div>
            <button className="btn btn-ghost" style={{ width: '100%' }}>Lancer le backtest →</button>
          </div>
        </div>

        {/* Watchlist */}
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              Watchlist <Help tip="Liste des actifs surveillés en permanence par les agents." />
            </div>
            <button className="btn btn-ghost btn-sm">+ Ajouter</button>
          </div>
          <div style={{ padding: 8 }}>
            {[
              ['AAPL', 'Apple Inc.', 0.42],
              ['MSFT', 'Microsoft', -0.18],
              ['NVDA', 'Nvidia', 1.94],
              ['TSLA', 'Tesla', -0.62],
              ['BTC', 'Bitcoin', 0.83],
              ['ETH', 'Ethereum', -0.24],
            ].map(([s, n, p]) => (
              <div key={s as string} className="flex between center" style={{ padding: '10px 12px', borderRadius: 6, fontSize: 13 }}>
                <div className="flex gap-3 center">
                  <span className="mono" style={{ fontWeight: 600, width: 60 }}>{s as string}</span>
                  <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{n as string}</span>
                </div>
                <div className="flex gap-3 center">
                  <span className={`mono ${(p as number) >= 0 ? 'up' : 'down'}`} style={{ fontSize: 12 }}>
                    {(p as number) >= 0 ? '+' : ''}{(p as number).toFixed(2)}%
                  </span>
                  <button style={{ padding: 4, background: 'none', border: 'none', color: 'var(--ink-4)', cursor: 'pointer', fontSize: 14 }}>×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
