import { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, CandlestickData, LineData } from 'lightweight-charts';
import type { OHLCVBar } from '../../types';

interface CandlestickChartProps {
  data: OHLCVBar[];
  ticker: string;
  height?: number;
}

function toTimestamp(timeStr: string): number {
  return Math.floor(new Date(timeStr).getTime() / 1000);
}

function computeEMA(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = data[0];
  for (const val of data) {
    ema = val * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

export function CandlestickChart({ data, ticker, height = 360 }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#111827' },
        textColor: '#8892A4',
        fontFamily: 'DM Mono',
      },
      grid: {
        vertLines: { color: '#1E2D45' },
        horzLines: { color: '#1E2D45' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1E2D45' },
      timeScale: {
        borderColor: '#1E2D45',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00D4AA',
      downColor: '#FF4D6D',
      borderUpColor: '#00D4AA',
      borderDownColor: '#FF4D6D',
      wickUpColor: '#00D4AA',
      wickDownColor: '#FF4D6D',
    });
    candleRef.current = candleSeries;

    if (data.length > 0) {
      const sorted = [...data].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const candleData: CandlestickData[] = sorted.map((bar) => ({
        time: toTimestamp(bar.time) as unknown as CandlestickData['time'],
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }));
      candleSeries.setData(candleData);

      // EMA overlays
      const closes = sorted.map((b) => b.close);
      const emas: [number[], string, number][] = [
        [computeEMA(closes, 9), '#4A9EFF', 9],
        [computeEMA(closes, 21), '#FFB347', 21],
        [computeEMA(closes, 50), '#8892A4', 50],
      ];

      for (const [emaValues, color] of emas) {
        const emaSeries = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false });
        const emaData: LineData[] = sorted.map((bar, i) => ({
          time: toTimestamp(bar.time) as unknown as LineData['time'],
          value: emaValues[i],
        }));
        emaSeries.setData(emaData);
      }

      chart.timeScale().fitContent();
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, height, ticker]);

  return (
    <div className="relative">
      <div className="absolute top-2 left-3 z-10 flex items-center gap-4">
        <span className="font-syne font-bold text-text-primary">{ticker}</span>
        <span className="text-[11px] text-text-secondary font-mono">EMA</span>
        <span className="text-[11px] font-mono" style={{ color: '#4A9EFF' }}>9</span>
        <span className="text-[11px] font-mono" style={{ color: '#FFB347' }}>21</span>
        <span className="text-[11px] font-mono" style={{ color: '#8892A4' }}>50</span>
      </div>
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
