import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { Trade } from '../../types';

interface PortfolioChartProps {
  history: Trade[];
  startingValue?: number;
}

interface DataPoint {
  time: string;
  value: number;
}

export function PortfolioChart({ history, startingValue = 10000 }: PortfolioChartProps) {
  // Build cumulative P&L curve from trade history
  const sorted = [...history]
    .filter((t) => t.closedAt)
    .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

  let cumulative = startingValue;
  const data: DataPoint[] = [{ time: 'Start', value: startingValue }];

  for (const trade of sorted) {
    cumulative += trade.pnlUsd || 0;
    data.push({
      time: new Date(trade.closedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Math.round(cumulative * 100) / 100,
    });
  }

  if (data.length === 1) {
    data.push({ time: 'Now', value: startingValue });
  }

  const minVal = Math.min(...data.map((d) => d.value));
  const maxVal = Math.max(...data.map((d) => d.value));
  const isPositive = data[data.length - 1].value >= startingValue;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={isPositive ? '#00D4AA' : '#FF4D6D'} stopOpacity={0.3} />
            <stop offset="95%" stopColor={isPositive ? '#00D4AA' : '#FF4D6D'} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tick={{ fill: '#8892A4', fontSize: 10, fontFamily: 'DM Mono' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[minVal * 0.995, maxVal * 1.005]}
          tick={{ fill: '#8892A4', fontSize: 10, fontFamily: 'DM Mono' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
        />
        <Tooltip
          contentStyle={{
            background: '#1C2333',
            border: '1px solid #1E2D45',
            borderRadius: 6,
            fontFamily: 'DM Mono',
            fontSize: 12,
          }}
          labelStyle={{ color: '#8892A4' }}
          itemStyle={{ color: isPositive ? '#00D4AA' : '#FF4D6D' }}
          formatter={(value: number) => [`$${value.toFixed(2)}`, 'Value']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={isPositive ? '#00D4AA' : '#FF4D6D'}
          strokeWidth={2}
          fill="url(#portfolioGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
