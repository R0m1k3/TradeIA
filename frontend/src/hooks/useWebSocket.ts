import { useEffect, useRef, useState } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import type { WsMessage, CycleUpdate, MarketContext, SignalItem } from '../types';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const isSecure = window.location.protocol === 'https:';
const wsProtocol = isSecure ? 'wss:' : 'ws:';
const WS_URL = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.host}/ws`;
const API_URL = import.meta.env.VITE_API_URL || '/api';
const MAX_BACKOFF = 30_000;

export function useWebSocket() {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { setPortfolio } = usePortfolioStore();
  const { setSignals, setMarket, setOrdersExecuted, setAgents, addAlert, setLastUpdate } = useSignalsStore();

  /** Fetch initial data from REST endpoints before first WS cycle */
  async function fetchInitialData() {
    try {
      const [marketRes, signalsRes, portfolioRes] = await Promise.allSettled([
        fetch(`${API_URL}/market/context`),
        fetch(`${API_URL}/signals`),
        fetch(`${API_URL}/portfolio`),
      ]);

      if (marketRes.status === 'fulfilled' && marketRes.value.ok) {
        const market = await marketRes.value.json() as MarketContext;
        if (market.vix || market.fear_greed) setMarket(market);
      }

      if (signalsRes.status === 'fulfilled' && signalsRes.value.ok) {
        const data = await signalsRes.value.json() as { signals: SignalItem[] };
        if (data.signals?.length) setSignals(data.signals);
      }

      if (portfolioRes.status === 'fulfilled' && portfolioRes.value.ok) {
        const portfolio = await portfolioRes.value.json();
        if (portfolio?.total_usd !== undefined) setPortfolio(portfolio);
      }
    } catch (err) {
      console.warn('[WS] Initial data fetch failed:', err);
    }
  }

  function handleMessage(msg: WsMessage) {
    setLastUpdate(msg.timestamp);

    if (msg.type === 'CYCLE_UPDATE') {
      const payload = msg.payload as CycleUpdate;
      if (payload.portfolio) setPortfolio(payload.portfolio);
      if (payload.market) setMarket(payload.market);
      if (payload.signals) setSignals(payload.signals);
      if (payload.orders_executed) setOrdersExecuted(payload.orders_executed);
      if (payload.agents) setAgents(payload.agents);
      if (payload.alerts) {
        for (const alert of payload.alerts) addAlert(alert);
      }
    }

    if (msg.type === 'ALERT') {
      const p = msg.payload as { level: 'info' | 'warning' | 'critical'; message: string; ticker?: string };
      addAlert(p);
    }

    if (msg.type === 'POSITION_CLOSED') {
      const p = msg.payload as { ticker: string; pnlUsd: number; reason: string };
      addAlert({
        level: p.pnlUsd >= 0 ? 'info' : 'warning',
        message: `Position closed: ${p.ticker} ${p.pnlUsd >= 0 ? '+' : ''}$${p.pnlUsd.toFixed(2)} [${p.reason}]`,
        ticker: p.ticker,
      });
    }
  }

  function connect() {
    try {
      setStatus('connecting');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        backoffRef.current = 1000;
        console.log('[WS] Connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as WsMessage;
          handleMessage(msg);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus('disconnected');
        wsRef.current = null;
        scheduleReconnect();
      };
    } catch {
      setStatus('error');
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
    console.log(`[WS] Reconnecting in ${delay}ms`);
    reconnectRef.current = setTimeout(connect, delay);
  }

  useEffect(() => {
    connect();
    fetchInitialData();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status };
}
