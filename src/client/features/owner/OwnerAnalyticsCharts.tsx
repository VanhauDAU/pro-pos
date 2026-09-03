import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface RevenueTrendPoint {
  label: string;
  revenue: number;
  goodsRevenue?: number;
  timeRevenue?: number;
  grossRevenue?: number;
  invoiceCount: number;
}

interface HourlyRevenuePoint {
  hour: number;
  label: string;
  revenue: number;
  invoiceCount: number;
}

interface DonutSlice {
  key: string;
  label: string;
  value: number;
  percentage: number;
  color: string;
}

interface BreakdownRow {
  key: string;
  label: string;
  amount: number;
  percentage: number;
  invoiceCount: number;
}

const MONEY_FORMATTER = new Intl.NumberFormat('vi-VN');
const SERIES_LABELS: Record<string, string> = {
  goodsRevenue: 'Tiền hàng',
  timeRevenue: 'Tiền giờ',
  revenue: 'Doanh thu thuần',
};

function money(value: number) {
  return `${MONEY_FORMATTER.format(Math.round(value))} đ`;
}

function shortMoney(value: number) {
  if (Math.abs(value) >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))} tỷ`;
  if (Math.abs(value) >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))} tr`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

const tooltipStyle = {
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.12)',
  fontSize: 12,
};

export function RevenueTrendChart({ points }: { points: RevenueTrendPoint[] }) {
  const data = points.map((point) => {
    const timeRevenue = point.timeRevenue ?? 0;
    const grossRevenue = point.grossRevenue ?? point.revenue;
    return {
      ...point,
      timeRevenue,
      goodsRevenue: point.goodsRevenue ?? Math.max(0, grossRevenue - timeRevenue),
    };
  });
  if (!data.some((point) => point.revenue > 0 || point.goodsRevenue > 0 || point.timeRevenue > 0)) {
    return <div className="owner-modern-chart-empty">Chưa có doanh thu hoàn tất trong kỳ</div>;
  }

  return (
    <div className="owner-modern-chart owner-modern-chart--trend">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="ownerGoodsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.92} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.58} />
            </linearGradient>
            <linearGradient id="ownerTimeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.92} />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.62} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e8eef6" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={34}
            height={32}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={shortMoney}
            width={48}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => [
              money(Number(value ?? 0)),
              SERIES_LABELS[String(name)] ?? String(name),
            ]}
            labelFormatter={(label) => `Thời gian: ${String(label)}`}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value) => SERIES_LABELS[String(value)] ?? String(value)}
          />
          <Bar
            dataKey="goodsRevenue"
            name="goodsRevenue"
            stackId="gross"
            fill="url(#ownerGoodsGradient)"
            radius={[0, 0, 4, 4]}
            maxBarSize={30}
            animationDuration={500}
          />
          <Bar
            dataKey="timeRevenue"
            name="timeRevenue"
            stackId="gross"
            fill="url(#ownerTimeGradient)"
            radius={[5, 5, 0, 0]}
            maxBarSize={30}
            animationDuration={500}
          />
          <Line
            type="monotone"
            dataKey="revenue"
            name="revenue"
            stroke="#059669"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: '#059669', stroke: '#fff', strokeWidth: 2 }}
            animationDuration={600}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HourlyRevenueChart({ points }: { points: HourlyRevenuePoint[] }) {
  const peak = points.reduce<HourlyRevenuePoint | null>(
    (current, point) => (!current || point.revenue > current.revenue ? point : current),
    null,
  );
  if (!peak || peak.revenue <= 0) {
    return <div className="owner-modern-chart-empty">Chưa có dữ liệu thanh toán theo giờ</div>;
  }

  return (
    <div className="owner-modern-chart owner-modern-chart--hourly">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="ownerHourlyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.42} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e8eef6" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="hour"
            type="number"
            domain={[0, 23]}
            ticks={[0, 3, 6, 9, 12, 15, 18, 21, 23]}
            tickFormatter={(hour) => `${hour}h`}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 11 }}
            height={30}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={shortMoney}
            width={48}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [money(Number(value ?? 0)), 'Doanh thu']}
            labelFormatter={(_, payload) => payload[0]?.payload?.label ?? ''}
          />
          {peak && peak.revenue > 0 ? (
            <ReferenceLine x={peak.hour} stroke="#f59e0b" strokeDasharray="4 4" />
          ) : null}
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#059669"
            strokeWidth={2.5}
            fill="url(#ownerHourlyGradient)"
            activeDot={{ r: 5, fill: '#059669', stroke: '#fff', strokeWidth: 2 }}
            animationDuration={600}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ModernDonutChart({
  slices,
  isMoney = true,
  unit = 'mục',
}: {
  slices: DonutSlice[];
  isMoney?: boolean;
  unit?: string;
}) {
  const visibleSlices = slices.filter((slice) => slice.value > 0);
  const total = visibleSlices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return <div className="owner-modern-chart-empty">Chưa có dữ liệu</div>;

  return (
    <div className="owner-modern-donut">
      <div className="owner-modern-donut__chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, _name, item) => [
                isMoney ? money(Number(value ?? 0)) : `${value} ${unit}`,
                item.payload?.label ?? '',
              ]}
            />
            <Pie
              data={visibleSlices}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="61%"
              outerRadius="84%"
              paddingAngle={2}
              cornerRadius={5}
              stroke="none"
              animationDuration={550}
            >
              {visibleSlices.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="owner-modern-donut__center">
          <span>Tổng cộng</span>
          <strong>{isMoney ? shortMoney(total) : total}</strong>
          <small>{isMoney ? 'doanh thu' : unit}</small>
        </div>
      </div>
      <div className="owner-modern-donut__legend">
        {visibleSlices.map((slice) => (
          <div key={slice.key}>
            <i style={{ background: slice.color }} />
            <span>{slice.label}</span>
            <b>{slice.percentage}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BreakdownBarChart({
  rows,
  color = '#0975f7',
}: {
  rows: BreakdownRow[];
  color?: string;
}) {
  if (!rows.some((row) => row.amount > 0)) {
    return <div className="owner-modern-chart-empty">Chưa có dữ liệu</div>;
  }
  const height = Math.max(230, rows.length * 52);
  return (
    <div className="owner-modern-breakdown" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#e8eef6" strokeDasharray="4 4" horizontal={false} />
          <XAxis
            type="number"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={shortMoney}
          />
          <YAxis
            type="category"
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#475569', fontSize: 11 }}
            width={105}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [money(Number(value ?? 0)), 'Doanh thu']}
          />
          <Bar
            dataKey="amount"
            fill={color}
            radius={[0, 7, 7, 0]}
            maxBarSize={22}
            animationDuration={500}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
