import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDate, fmtHeadline, fmtPrice } from '../format'

// Recharts is loaded only with a page that draws a chart. Every number on an axis or in a tooltip goes through the
// app's own formatters, so hidden numbers stay hidden in charts too.

const AXIS = { stroke: 'var(--muted-foreground)', fontSize: 11, tickLine: false, axisLine: false } as const

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d}/${m}`
}

function TooltipBox({ title, lines }: { title: string; lines: { label: string; value: string; color: string }[] }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-[12.5px] shadow-sm">
      <p className="mb-1 font-semibold">{title}</p>
      {lines.map((l) => (
        <p key={l.label} className="flex items-center gap-1.5 tabular-nums">
          <span className="size-2 rounded-full" style={{ background: l.color }} aria-hidden />
          {l.label} {l.value}
        </p>
      ))}
    </div>
  )
}

export interface ValueDatum {
  date: string
  value: number
  invested: number
}

export function ValueChart({ data, base }: { data: ValueDatum[]; base: string }) {
  return (
    <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 600, height: 220 }}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...AXIS} />
        <YAxis width={64} tickFormatter={(v: number) => fmtHeadline(String(v), base)} {...AXIS} />
        <Tooltip
          content={({ active, payload }) => {
            const d = active && payload?.[0]?.payload as ValueDatum | undefined
            return d ? (
              <TooltipBox
                title={fmtDate(d.date)}
                lines={[
                  { label: 'มูลค่า', value: fmtHeadline(String(d.value), base), color: 'var(--primary)' },
                  { label: 'เงินลงทุน', value: fmtHeadline(String(d.invested), base), color: 'var(--muted-foreground)' },
                ]}
              />
            ) : null
          }}
        />
        <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} fill="var(--primary-soft)" isAnimationActive={false} />
        <Line type="stepAfter" dataKey="invested" stroke="var(--muted-foreground)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export interface TotalDatum {
  date: string
  total: number
}

export function RealizedChart({ data, base }: { data: TotalDatum[]; base: string }) {
  const last = data[data.length - 1]?.total ?? 0
  const color = last < 0 ? 'var(--loss)' : 'var(--gain)'
  return (
    <ResponsiveContainer width="100%" height={200} initialDimension={{ width: 600, height: 200 }}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...AXIS} />
        <YAxis width={64} tickFormatter={(v: number) => fmtHeadline(String(v), base)} {...AXIS} />
        <Tooltip
          content={({ active, payload }) => {
            const d = active && payload?.[0]?.payload as TotalDatum | undefined
            return d ? <TooltipBox title={fmtDate(d.date)} lines={[{ label: 'กำไรสะสม', value: fmtHeadline(String(d.total), base), color }]} /> : null
          }}
        />
        <Line type="stepAfter" dataKey="total" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export interface PriceDatum {
  date: string
  price: number
  kind: 'buy' | 'sell' | 'opening' | 'last'
}

const MARK_COLORS = { buy: 'var(--gain)', sell: 'var(--loss)', opening: 'var(--primary)', last: 'var(--muted-foreground)' }
const MARK_LABELS = { buy: 'ซื้อ', sell: 'ขาย', opening: 'ยอดยกมา', last: 'ราคาล่าสุด' }

export function PriceChart({ data, currency }: { data: PriceDatum[]; currency: string }) {
  return (
    <ResponsiveContainer width="100%" height={200} initialDimension={{ width: 600, height: 200 }}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...AXIS} />
        <YAxis width={56} domain={['auto', 'auto']} tickFormatter={(v: number) => fmtPrice(String(v))} {...AXIS} />
        <Tooltip
          content={({ active, payload }) => {
            const d = active && payload?.[0]?.payload as PriceDatum | undefined
            return d ? (
              <TooltipBox title={fmtDate(d.date)} lines={[{ label: MARK_LABELS[d.kind], value: `${fmtPrice(String(d.price))} ${currency}`, color: MARK_COLORS[d.kind] }]} />
            ) : null
          }}
        />
        <Line type="linear" dataKey="price" stroke="var(--ink-2)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Scatter
          dataKey="price"
          isAnimationActive={false}
          shape={(props: { cx?: number; cy?: number; payload?: PriceDatum }) =>
            props.cx === undefined || props.cy === undefined || !props.payload ? <g /> : (
              <circle cx={props.cx} cy={props.cy} r={5} fill={MARK_COLORS[props.payload.kind]} stroke="var(--card)" strokeWidth={2} />
            )
          }
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
