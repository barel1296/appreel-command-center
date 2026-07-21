// Recharts wrappers with consistent theming.
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fmtDate } from '@/lib/format'

const AXIS = { stroke: 'rgba(148,163,203,0.25)', fontSize: 10, tickLine: false, axisLine: false }
const GRID = { stroke: 'rgba(148,163,203,0.08)', vertical: false }

function ChartTip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-4 border border-line-strong rounded-lg px-3 py-2 shadow-pop text-xs">
      <div className="text-ink-low mb-1">{typeof label === 'string' && /^\d{4}-/.test(label) ? fmtDate(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.stroke ?? p.fill }} />
          <span className="text-ink-mid">{p.name}:</span>
          <span className="num font-semibold text-ink-hi">{fmt ? fmt(p.value, p.dataKey) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export interface SeriesDef {
  key: string
  name: string
  color: string
  dashed?: boolean
}

export function TrendChart({ data, series, height = 200, fmt, yFmt }: {
  data: Record<string, unknown>[]
  series: SeriesDef[]
  height?: number
  fmt?: (v: number, key: string) => string
  yFmt?: (v: number) => string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -14 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={(v) => (typeof v === 'string' && /^\d{4}-/.test(v) ? fmtDate(v) : v)} minTickGap={30} />
        <YAxis {...AXIS} tickFormatter={yFmt} width={54} />
        <Tooltip content={<ChartTip fmt={fmt} />} />
        {series.map((s) => (
          <Line
            key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color}
            strokeWidth={1.8} dot={false} strokeDasharray={s.dashed ? '4 3' : undefined}
            activeDot={{ r: 3.5 }} connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function AreaTrend({ data, series, height = 200, fmt, yFmt, stacked }: {
  data: Record<string, unknown>[]
  series: SeriesDef[]
  height?: number
  fmt?: (v: number, key: string) => string
  yFmt?: (v: number) => string
  stacked?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -14 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" {...AXIS} tickFormatter={(v) => (typeof v === 'string' && /^\d{4}-/.test(v) ? fmtDate(v) : v)} minTickGap={30} />
        <YAxis {...AXIS} tickFormatter={yFmt} width={54} />
        <Tooltip content={<ChartTip fmt={fmt} />} />
        {series.map((s) => (
          <Area
            key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color}
            strokeWidth={1.8} fill={`url(#g-${s.key})`} stackId={stacked ? 'a' : undefined} connectNulls
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function BarsChart({ data, xKey, bars, height = 200, fmt, yFmt, colorBy }: {
  data: Record<string, unknown>[]
  xKey: string
  bars: SeriesDef[]
  height?: number
  fmt?: (v: number, key: string) => string
  yFmt?: (v: number) => string
  colorBy?: (row: Record<string, unknown>) => string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -14 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} {...AXIS} minTickGap={10} interval={0} tickFormatter={(v) => String(v).length > 9 ? String(v).slice(0, 8) + '…' : v} />
        <YAxis {...AXIS} tickFormatter={yFmt} width={54} />
        <Tooltip content={<ChartTip fmt={fmt} />} cursor={{ fill: 'rgba(148,163,203,0.06)' }} />
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[4, 4, 0, 0]} maxBarSize={38}>
            {colorBy && data.map((row, i) => <Cell key={i} fill={colorBy(row)} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
