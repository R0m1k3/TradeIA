import { useEffect, useRef, useState } from 'react';
import { useConfigStore } from '../store/config.store';
import { usePortfolioStore } from '../store/portfolio.store';
import { WatchlistEditor } from '../components/controls/WatchlistEditor';
import { OverridePanel } from '../components/controls/OverridePanel';

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
        placeholder={isSet ? 'API key configurée' : placeholder}
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
      {isSet && (
        <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, fontFamily: 'var(--mono)' }}>
          ✓ Configurée
        </div>
      )}
    </div>
  );
}

interface AILogMeta {
  id: string;
  createdAt: string;
  durationMs: number;
  tickersCount: number;
  proposalsCount: number;
  executedCount: number;
  rejectionsCount: number;
}

export function Config() {
  const { config, secretsConfigured, fetchConfig, saveConfig, saveSecret, setConfig } = useConfigStore();
  const { fetchPortfolio, fetchHistory, fetchTypeStats } = usePortfolioStore();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [alpacaTestResult, setAlpacaTestResult] = useState<string | null>(null);
  const [testingAlpaca, setTestingAlpaca] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [aiLogs, setAiLogs] = useState<AILogMeta[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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

  async function fetchAiLogs() {
    setLogsLoading(true);
    try {
      const res = await fetch(`${API}/ai-logs`);
      if (res.ok) setAiLogs(await res.json());
    } catch { /* ignore */ } finally {
      setLogsLoading(false);
    }
  }

  async function downloadAllLogs() {
    const res = await fetch(`${API}/ai-logs/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadLog(id: string) {
    const res = await fetch(`${API}/ai-logs/${id}/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-log-${id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteLog(id: string) {
    await fetch(`${API}/ai-logs/${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    fetchAiLogs();
  }

  async function deleteAllLogs() {
    await fetch(`${API}/ai-logs`, { method: 'DELETE' });
    setDeleteConfirm(null);
    setAiLogs([]);
  }

  useEffect(() => {
    fetchConfig().then(() => fetchModels());
    fetchAiLogs();
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

  async function testAlpaca() {
    setTestingAlpaca(true);
    setAlpacaTestResult(null);
    try {
      const res = await fetch(`${API}/config/test-alpaca`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setAlpacaTestResult(`✓ ${data.message} — Equity $${data.equity} | Cash $${data.cash}`);
      } else {
        setAlpacaTestResult(`✗ ${data.message}`);
      }
    } catch {
      setAlpacaTestResult('✗ Connexion échouée');
    }
    setTestingAlpaca(false);
  }

  async function testLLM() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/config/test-llm`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const modelsInfo = data.models_available?.length > 0
          ? ` (${data.models_available.length} models: ${data.models_available.slice(0, 3).join(', ')}${data.models_available.length > 3 ? '...' : ''})`
          : '';
        setTestResult(`✓ ${data.message} — ${data.provider}/${data.model}${modelsInfo}`);
      } else {
        setTestResult(`✗ ${data.message}`);
      }
    } catch {
      setTestResult('✗ Connexion échouée');
    }
    setTesting(false);
  }

  async function resetPortfolio() {
    const confirmed = window.confirm('Réinitialiser le portefeuille, les positions ouvertes et tout l’historique des trades ?');
    if (!confirmed) return;

    setResetting(true);
    setResetResult(null);
    try {
      const res = await fetch(`${API}/portfolio/reset`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await Promise.all([fetchPortfolio(), fetchHistory(), fetchTypeStats()]);
      setResetResult(`Réinitialisé : ${data.reset?.trades ?? 0} trades supprimés`);
    } catch {
      setResetResult('Réinitialisation échouée');
    } finally {
      setResetting(false);
    }
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
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement...' : 'Enregistrer tout'}
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* ── LLM Configuration ── */}
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              IA & LLM <Help tip="Configurez votre provider IA, la clé API et les modèles utilisés par les agents." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <label className="label">Provider</label>
            <select
              className="select"
              value={config.llm_provider}
              onChange={(e) => saveConfig({ llm_provider: e.target.value })}
              style={{ marginBottom: 16 }}
            >
              <option value="openrouter">OpenRouter (Cloud)</option>
              <option value="ollama">Ollama (Local GPU)</option>
            </select>

            {config.llm_provider === 'openrouter' && (
              <ApiKeyInput
                label="Clé API OpenRouter"
                configured={secretsConfigured.openrouter_api_key}
                placeholder="sk-or-v1-..."
                onSave={(val) => saveSecret('openrouter_api_key', val)}
              />
            )}

            {config.llm_provider === 'ollama' && (
              <div style={{ marginBottom: 12 }}>
                <label className="label">URL Ollama</label>
                <input
                  type="text"
                  placeholder="http://172.x.x.x:11434"
                  value={config.ollama_base_url || ''}
                  onChange={(e) => saveConfig({ ollama_base_url: e.target.value })}
                  className="input"
                />
              </div>
            )}

            {config.llm_provider === 'ollama' && (
              <ApiKeyInput
                label="Clé API Ollama (cloud models)"
                configured={secretsConfigured.ollama_api_key}
                placeholder="Requis pour les modèles :cloud"
                onSave={(val) => saveSecret('ollama_api_key', val)}
              />
            )}

            <label className="label">Modèle Léger <Help tip="Modèle rapide pour les tâches simples (screening, formatage)." /></label>
            <select
              className="select"
              value={config.model_light}
              onChange={(e) => saveConfig({ model_light: e.target.value })}
              disabled={loadingModels}
              style={{ marginBottom: 12 }}
            >
              {loadingModels && <option value="">Chargement...</option>}
              {!loadingModels && models.length === 0 && <option value="">Aucun modèle disponible</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>

            <label className="label">Modèle Intermédiaire <Help tip="Modèle équilibré pour l'analyse et la recherche." /></label>
            <select
              className="select"
              value={config.model_mid}
              onChange={(e) => saveConfig({ model_mid: e.target.value })}
              disabled={loadingModels}
              style={{ marginBottom: 12 }}
            >
              {loadingModels && <option value="">Chargement...</option>}
              {!loadingModels && models.length === 0 && <option value="">Aucun modèle disponible</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>

            <label className="label">Modèle Puissant <Help tip="Modèle le plus capable pour les décisions critiques et le raisonnement complexe." /></label>
            <select
              className="select"
              value={config.model_strong}
              onChange={(e) => saveConfig({ model_strong: e.target.value })}
              disabled={loadingModels}
              style={{ marginBottom: 16 }}
            >
              {loadingModels && <option value="">Chargement...</option>}
              {!loadingModels && models.length === 0 && <option value="">Aucun modèle disponible</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={testLLM} disabled={testing}>
                {testing ? 'Test en cours...' : 'Tester la connexion'}
              </button>
              {testResult && (
                <span className="mono" style={{
                  fontSize: 12,
                  color: testResult.startsWith('✓') ? 'var(--accent)' : 'var(--danger)',
                }}>
                  {testResult}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Market Data APIs ── */}
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              API Marché <Help tip="Clés API pour les sources de données financières. Au moins une est requise." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <ApiKeyInput
              label="Polygon.io (actions US)"
              configured={secretsConfigured.polygon_key}
              placeholder="Clé API Polygon"
              onSave={(val) => saveSecret('polygon_key', val)}
            />

            <ApiKeyInput
              label="Alpha Vantage (news, options, compléments)"
              configured={secretsConfigured.alpha_vantage_key}
              placeholder="Clé API Alpha Vantage"
              onSave={(val) => saveSecret('alpha_vantage_key', val)}
            />

            <ApiKeyInput
              label="Finnhub (news/actions, fallback)"
              configured={secretsConfigured.finnhub_key}
              placeholder="Clé API Finnhub"
              onSave={(val) => saveSecret('finnhub_key', val)}
            />

            <ApiKeyInput
              label="Twelve Data (actions/indices US + EU live)"
              configured={secretsConfigured.twelve_data_key}
              placeholder="Clé API Twelve Data"
              onSave={(val) => saveSecret('twelve_data_key', val)}
            />

            <ApiKeyInput
              label="EODHD (données historiques EU, fondamentales)"
              configured={secretsConfigured.eodhd_key}
              placeholder="Clé API EODHD"
              onSave={(val) => saveSecret('eodhd_key', val)}
            />

            <ApiKeyInput
              label="FRED (Macro)"
              configured={secretsConfigured.fred_api_key}
              placeholder="Clé gratuite sur fred.stlouisfed.org"
              onSave={(val) => saveSecret('fred_api_key', val)}
            />

            <div style={{ padding: 12, background: 'var(--bg-elev-2)', borderRadius: 6, fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
              Astuce : Twelve Data couvre les actions US et européennes. EODHD est un bon complément pour les données historiques et fondamentales européennes.
              L'application croise Twelve Data, Polygon, Yahoo, EODHD, TradingView et les flux news.
            </div>
          </div>
        </div>

        {/* ── Broker d'exécution ── */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-h">
            <div className="card-h-title">
              Broker d'exécution <Help tip="Choisissez comment les ordres sont exécutés : simulation locale ou Alpaca (paper/live)." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div>
                <label className="label">Type de broker</label>
                <select
                  className="select"
                  value={config.broker_type}
                  onChange={(e) => saveConfig({ broker_type: e.target.value })}
                  style={{ marginBottom: 16 }}
                >
                  <option value="mock">Mock (simulation locale)</option>
                  <option value="alpaca">Alpaca (paper ou live)</option>
                  <option value="none">Aucun (dry-run, analyse seulement)</option>
                </select>

                {config.broker_type === 'mock' && (
                  <div style={{ padding: 12, background: 'var(--bg-elev-2)', borderRadius: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                    Simulation locale — aucun argent réel. Trades exécutés en base avec slippage simulé.
                  </div>
                )}

                {config.broker_type === 'none' && (
                  <div style={{ padding: 12, background: 'var(--bg-elev-2)', borderRadius: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                    Dry-run — les agents analysent et valident les ordres mais n'exécutent rien.
                  </div>
                )}

                {config.broker_type === 'alpaca' && (
                  <div>
                    <label className="label">Environnement Alpaca</label>
                    <select
                      className="select"
                      value={config.alpaca_base_url}
                      onChange={(e) => saveConfig({ alpaca_base_url: e.target.value })}
                      style={{ marginBottom: 16 }}
                    >
                      <option value="https://paper-api.alpaca.markets">Paper Trading (gratuit, aucun risque)</option>
                      <option value="https://api.alpaca.markets">Live Trading (argent réel ⚠️)</option>
                    </select>
                  </div>
                )}
              </div>

              {config.broker_type === 'alpaca' && (
                <div>
                  <ApiKeyInput
                    label="Alpaca API Key"
                    configured={secretsConfigured.alpaca_key}
                    placeholder="PKXXXXXXXXXXXXXXXXXXXXXXXX"
                    onSave={(val) => saveSecret('alpaca_key', val)}
                  />
                  <ApiKeyInput
                    label="Alpaca Secret Key"
                    configured={secretsConfigured.alpaca_secret}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    onSave={(val) => saveSecret('alpaca_secret', val)}
                  />
                  <div style={{ padding: 10, background: 'var(--bg-elev-2)', borderRadius: 6, fontSize: 11, color: 'var(--ink-3)', marginBottom: 12 }}>
                    Créez un compte sur{' '}
                    <strong style={{ color: 'var(--ink-2)' }}>app.alpaca.markets</strong>
                    {' '}→ Paper Account → API Keys. Paper trading = gratuit, pas de vérification d'identité requise.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={testAlpaca}
                      disabled={testingAlpaca || !secretsConfigured.alpaca_key || !secretsConfigured.alpaca_secret}
                    >
                      {testingAlpaca ? 'Test...' : 'Tester la connexion'}
                    </button>
                    {alpacaTestResult && (
                      <span className="mono" style={{
                        fontSize: 12,
                        color: alpacaTestResult.startsWith('✓') ? 'var(--accent)' : 'var(--danger)',
                      }}>
                        {alpacaTestResult}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Risk Parameters ── */}
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              Paramètres de risque <Help tip="Contrôlez l'exposition du portefeuille et les circuit-breakers automatiques." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <label className="label">Capital initial (USD)</label>
            <input
              type="number"
              value={config.portfolio_usd}
              onChange={(e) => saveConfig({ portfolio_usd: e.target.value })}
              className="input"
              min={1000}
              step={1000}
              style={{ marginBottom: 18 }}
            />

            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="label" style={{ marginBottom: 0 }}>Limite de perte journalière</span>
                <span className="mono" style={{ fontSize: 13, color: 'var(--warn)' }}>{config.daily_loss_limit_pct}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={parseFloat(config.daily_loss_limit_pct || '3')}
                onChange={(e) => setConfig({ daily_loss_limit_pct: e.target.value })}
                onPointerUp={(e) => saveConfig({ daily_loss_limit_pct: (e.target as HTMLInputElement).value })}
                style={{ width: '100%', accentColor: 'var(--warn)', marginBottom: 4 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                <span>1%</span>
                <span>10%</span>
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="label" style={{ marginBottom: 0 }}>Max Drawdown (Circuit Breaker)</span>
                <span className="mono" style={{ fontSize: 13, color: 'var(--danger)' }}>{config.max_drawdown_pct}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={30}
                step={1}
                value={parseFloat(config.max_drawdown_pct || '10')}
                onChange={(e) => setConfig({ max_drawdown_pct: e.target.value })}
                onPointerUp={(e) => saveConfig({ max_drawdown_pct: (e.target as HTMLInputElement).value })}
                style={{ width: '100%', accentColor: 'var(--danger)', marginBottom: 4 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                <span>5% — conservateur</span>
                <span>30% — permissif</span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink-3)', fontStyle: 'italic', marginTop: 6 }}>
                Si le portefeuille perd ce % depuis le capital initial → toutes positions fermées + trading suspendu 72h
              </p>
            </div>

            <div style={{ padding: 12, background: 'var(--warn-soft)', borderRadius: 6, fontSize: 12, color: 'var(--warn)', borderLeft: '3px solid var(--warn)' }}>
              Au-delà de 3% par trade, le drawdown peut dépasser votre seuil cible.
            </div>
          </div>
        </div>

        {/* ── System Settings ── */}
        <div className="card">
          <div className="card-h">
            <div className="card-h-title">
              Système <Help tip="Paramètres techniques de fonctionnement et mode d'exécution." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Mode automatique</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Les agents exécutent les trades sans validation manuelle</div>
              </div>
              <button
                onClick={() => saveConfig({ mock_broker: config.mock_broker === 'true' ? 'false' : 'true' })}
                style={{
                  width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: config.mock_broker === 'true' ? 'var(--accent)' : 'var(--bg-elev-2)',
                  position: 'relative', transition: 'all 0.2s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2,
                  left: config.mock_broker === 'true' ? 20 : 2,
                  width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'all 0.2s',
                }} />
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Mock Broker (simulation)</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Trade en mode simulé, aucun argent réel engagé</div>
              </div>
              <button
                onClick={() => saveConfig({ mock_broker: config.mock_broker === 'true' ? 'false' : 'true' })}
                style={{
                  width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: config.mock_broker === 'true' ? 'var(--accent)' : 'var(--bg-elev-2)',
                  position: 'relative', transition: 'all 0.2s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2,
                  left: config.mock_broker === 'true' ? 20 : 2,
                  width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'all 0.2s',
                }} />
              </button>
            </div>

            {/* Manual Overrides */}
            <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 16, marginTop: 8 }}>
              <div className="card-h-title" style={{ marginBottom: 12 }}>
                Contrôles manuels <Help tip="Bloquez un ticker, fermez une position ou forcez une action sur les signaux actifs." />
              </div>
              <OverridePanel />
            </div>

            <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 16, marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Remise à zéro</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Supprime trades, positions et historique IA</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={resetPortfolio} disabled={resetting}>
                  {resetting ? 'Reset...' : 'Reset'}
                </button>
              </div>
              {resetResult && (
                <div className="mono" style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: resetResult.includes('échouée') ? 'var(--danger)' : 'var(--accent)',
                }}>
                  {resetResult}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Watchlist ── */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-h">
            <div className="card-h-title">
              Watchlist <Help tip="Liste des actifs surveillés en permanence par les agents. Ajoutez ou retirez des tickers." />
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <WatchlistEditor />
          </div>
        </div>

        {/* ── AI Cycle Logs ── */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-h">
            <div className="card-h-title">
              Logs IA <Help tip="Historique des cycles IA (max 10). Téléchargez ou supprimez les logs pour analyser le comportement des agents." />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={downloadAllLogs} disabled={aiLogs.length === 0}>
                Tout télécharger
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--danger)' }}
                onClick={() => setDeleteConfirm('all')}
                disabled={aiLogs.length === 0}
              >
                Tout supprimer
              </button>
            </div>
          </div>
          <div style={{ padding: 20 }}>
            {deleteConfirm === 'all' && (
              <div style={{ marginBottom: 12, padding: 10, background: 'var(--danger-soft, rgba(255,60,60,0.1))', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--danger)' }}>Supprimer tous les logs ?</span>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={deleteAllLogs}>Confirmer</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>Annuler</button>
              </div>
            )}
            {logsLoading && <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Chargement...</div>}
            {!logsLoading && aiLogs.length === 0 && (
              <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Aucun log disponible.</div>
            )}
            {!logsLoading && aiLogs.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--mono)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--rule)', color: 'var(--ink-3)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Date</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>Durée</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>Tickers</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>Propositions</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>Exécutés</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>Rejets</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {aiLogs.map((log) => (
                    <>
                      {deleteConfirm === log.id && (
                        <tr key={`confirm-${log.id}`}>
                          <td colSpan={7} style={{ padding: '6px 8px', background: 'var(--danger-soft, rgba(255,60,60,0.1))' }}>
                            <span style={{ color: 'var(--danger)', fontSize: 12 }}>Supprimer ce log ? </span>
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', marginLeft: 8 }} onClick={() => deleteLog(log.id)}>Confirmer</button>
                            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => setDeleteConfirm(null)}>Annuler</button>
                          </td>
                        </tr>
                      )}
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--rule)' }}>
                        <td style={{ padding: '6px 8px', color: 'var(--ink-2)' }}>{new Date(log.createdAt).toLocaleString('fr-FR')}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--ink-3)' }}>{(log.durationMs / 1000).toFixed(1)}s</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{log.tickersCount}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: log.proposalsCount > 0 ? 'var(--accent)' : 'var(--ink-3)' }}>{log.proposalsCount}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: log.executedCount > 0 ? 'var(--accent)' : 'var(--ink-3)' }}>{log.executedCount}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: log.rejectionsCount > 0 ? 'var(--warn)' : 'var(--ink-3)' }}>{log.rejectionsCount}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => downloadLog(log.id)} title="Télécharger">↓</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setDeleteConfirm(log.id)} title="Supprimer">×</button>
                        </td>
                      </tr>
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
