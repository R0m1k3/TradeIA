import { useEffect, useRef, useState } from 'react';
import { usePortfolioStore } from '../store/portfolio.store';
import { useSignalsStore } from '../store/signals.store';
import type { WsMessage, CycleUpdate } from '../types';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost/ws';
const MAX_BACKOFF = 30_000;

export function useWebSocket() {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { setPortfolio } = usePortfolioStore();
  const { setSignals, setMarket, setOrdersExecuted, setAgents, addAlert, setLastUpdate } = useSignalsStore();

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
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status };
}
