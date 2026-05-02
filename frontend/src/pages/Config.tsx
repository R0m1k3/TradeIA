import { useEffect, useRef, useState } from 'react';
import { useConfigStore } from '../store/config.store';
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

export function Config() {
  const { config, secretsConfigured, fetchConfig, saveConfig, saveSecret } = useConfigStore();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

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
              label="Alpha Vantage"
              configured={secretsConfigured.alpha_vantage_key}
              placeholder="Clé API"
              onSave={(val) => saveSecret('alpha_vantage_key', val)}
            />
            <ApiKeyInput
              label="Polygon.io"
              configured={secretsConfigured.polygon_key}
              placeholder="Clé API"
              onSave={(val) => saveSecret('polygon_key', val)}
            />
            <ApiKeyInput
              label="Finnhub"
              configured={secretsConfigured.finnhub_key}
              placeholder="Clé API"
              onSave={(val) => saveSecret('finnhub_key', val)}
            />
            <ApiKeyInput
              label="FRED (Macro)"
              configured={secretsConfigured.fred_api_key}
              placeholder="Clé gratuite sur fred.stlouisfed.org"
              onSave={(val) => saveSecret('fred_api_key', val)}
            />

            <div style={{ padding: 12, background: 'var(--bg-elev-2)', borderRadius: 6, fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
              Astuce : FRED est gratuit et fournit les données macro (taux, inflation, emploi). Alpha Vantage offre un plan gratuit limité.
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
                onChange={(e) => saveConfig({ daily_loss_limit_pct: e.target.value })}
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
                onChange={(e) => saveConfig({ max_drawdown_pct: e.target.value })}
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
      </div>
    </div>
  );
}