import { useEffect, useState } from 'react';
import { useConfigStore } from '../store/config.store';
import { WatchlistEditor } from '../components/controls/WatchlistEditor';
import { OverridePanel } from '../components/controls/OverridePanel';

const API = import.meta.env.VITE_API_URL || '/api';


function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-border pb-2 mb-4">
      <h3 className="font-syne font-bold text-sm text-text-primary">{title}</h3>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <label className="text-xs text-text-secondary w-36 flex-shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const inputCls = 'w-full bg-bg-elevated border border-border rounded px-3 py-1.5 text-xs font-mono text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent-blue';
const selectCls = `${inputCls} cursor-pointer`;

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
    <FormRow label={label}>
      <input
        type="password"
        placeholder={isSet ? 'API key is set' : placeholder}
        value={isSet ? '' : value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => {
          setEditing(true);
          setValue('');
        }}
        onBlur={() => {
          setEditing(false);
          if (value.trim()) {
            onSave(value.trim());
          }
          setValue('');
        }}
        className={inputCls}
      />
    </FormRow>
  );
}

export function Config() {
  const { config, secretsConfigured, saveConfig, saveSecret } = useConfigStore();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);

  async function fetchModels() {
    try {
      const res = await fetch(`${API}/config/llm-models`);
      const data = await res.json();
      setModels(data);
    } catch (err) {
      console.error('Failed to fetch models:', err);
    }
  }

  useEffect(() => {
    fetchModels();
  }, [config.llm_provider]);

  async function handleSave() {
    setSaving(true);
    await saveConfig(config);
    await fetchModels(); // Re-fetch models with the new API key if needed
    setSaving(false);
  }

  async function testLLM() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) setTestResult('✓ Backend reachable');
      else setTestResult('✗ Backend unreachable');
    } catch {
      setTestResult('✗ Connection failed');
    }
    setTesting(false);
  }

  return (
    <div className="max-w-[1200px] space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* LLM Config */}
          <div className="bg-bg-surface rounded-lg border border-border p-6 space-y-4">
            <SectionHeader title="LLM Configuration" />

            <FormRow label="Provider">
              <select
                value={config.llm_provider}
                onChange={(e) => saveConfig({ llm_provider: e.target.value })}
                className={selectCls}
              >
                <option value="openrouter">OpenRouter (Cloud)</option>
                <option value="ollama">Ollama (Local GPU)</option>
              </select>
            </FormRow>

            {config.llm_provider === 'openrouter' && (
              <ApiKeyInput
                label="API Key"
                configured={secretsConfigured.openrouter_api_key}
                placeholder="sk-or-v1-..."
                onSave={(val) => saveSecret('openrouter_api_key', val)}
              />
            )}

            {config.llm_provider === 'ollama' && (
              <FormRow label="Ollama URL">
                <input
                  type="text"
                  placeholder="http://172.x.x.x:11434"
                  value={config.ollama_base_url || ''}
                  onChange={(e) => saveConfig({ ollama_base_url: e.target.value })}
                  className={inputCls}
                />
              </FormRow>
            )}

            <FormRow label="Model Light">
              <select
                value={config.model_light}
                onChange={(e) => saveConfig({ model_light: e.target.value })}
                className={selectCls}
              >
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormRow>

            <FormRow label="Model Mid">
              <select
                value={config.model_mid}
                onChange={(e) => saveConfig({ model_mid: e.target.value })}
                className={selectCls}
              >
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormRow>

            <FormRow label="Model Strong">
              <select
                value={config.model_strong}
                onChange={(e) => saveConfig({ model_strong: e.target.value })}
                className={selectCls}
              >
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormRow>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={testLLM}
                disabled={testing}
                className="px-4 py-1.5 bg-accent-blue/10 border border-accent-blue/30 text-accent-blue text-xs font-mono rounded hover:bg-accent-blue/20 transition-colors disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {testResult && (
                <span className={`text-xs font-mono ${testResult.startsWith('✓') ? 'text-accent-green' : 'text-accent-red'}`}>
                  {testResult}
                </span>
              )}
            </div>
          </div>

          {/* Market Data APIs */}
          <div className="bg-bg-surface rounded-lg border border-border p-6 space-y-4">
            <SectionHeader title="Market Data APIs" />

            <ApiKeyInput
              label="Alpha Vantage"
              configured={secretsConfigured.alpha_vantage_key}
              placeholder="API Key"
              onSave={(val) => saveSecret('alpha_vantage_key', val)}
            />
            <ApiKeyInput
              label="Polygon.io"
              configured={secretsConfigured.polygon_key}
              placeholder="API Key"
              onSave={(val) => saveSecret('polygon_key', val)}
            />
            <ApiKeyInput
              label="Finnhub"
              configured={secretsConfigured.finnhub_key}
              placeholder="API Key"
              onSave={(val) => saveSecret('finnhub_key', val)}
            />
          </div>

          {/* Watchlist */}
          <div className="bg-bg-surface rounded-lg border border-border p-6 space-y-4">
            <SectionHeader title="Watchlist" />
            <WatchlistEditor />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* System toggles */}
          <div className="bg-bg-surface rounded-lg border border-border p-6 space-y-4">
            <SectionHeader title="System Settings" />

            <div className="space-y-3">
              {[
                { key: 'mock_broker', label: 'Mock Broker (no real money)' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">{label}</span>
                  <button
                    onClick={() => saveConfig({ [key]: config[key] === 'true' ? 'false' : 'true' })}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      config[key] === 'true' ? 'bg-accent-green' : 'bg-bg-elevated border border-border'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        config[key] === 'true' ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Risk parameters */}
          <div className="bg-bg-surface rounded-lg border border-border p-6 space-y-4">
            <SectionHeader title="Risk Parameters" />

            <FormRow label="Portfolio USD">
              <input
                type="number"
                value={config.portfolio_usd}
                onChange={(e) => saveConfig({ portfolio_usd: e.target.value })}
                className={inputCls}
                min={1000}
                step={1000}
              />
            </FormRow>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">Daily Loss Limit</span>
                <span className="font-mono text-accent-amber">{config.daily_loss_limit_pct}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={parseFloat(config.daily_loss_limit_pct || '3')}
                onChange={(e) => saveConfig({ daily_loss_limit_pct: e.target.value })}
                className="w-full accent-accent-amber"
              />
              <div className="flex justify-between text-[10px] text-text-secondary">
                <span>1%</span>
                <span>10%</span>
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-accent-green/10 border border-accent-green/40 text-accent-green text-xs font-mono rounded hover:bg-accent-green/20 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>

          {/* Manual overrides */}
          <div className="bg-bg-surface rounded-lg border border-border p-6">
            <SectionHeader title="Manual Overrides" />
            <OverridePanel />
          </div>
        </div>
      </div>
    </div>
  );
}
