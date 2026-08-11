import { useEffect, useState, useCallback } from 'react';
import { Monitor, RefreshCw, TrendingUp, CheckCircle, XCircle, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import api from '@/lib/api';

const REFRESH_INTERVAL_MS = 15000;
const DAY_OPTIONS = [
  { value: '7',  label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const STAT_VARIANTS = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#141416',
  border: '1px solid #1f2022',
  borderRadius: 0,
  color: '#F2F3F5',
  fontSize: 12,
};

const TYPE_COLORS = ['#FF4500', '#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#06b6d4'];

function StatCard({ label, value, icon: Icon, accent }) {
  return (
    <motion.div
      variants={STAT_VARIANTS}
      className="bg-[#141416] border border-[#1f2022] p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[#9CA3AF] text-xs uppercase tracking-wider font-medium">{label}</p>
        <Icon className={`w-4 h-4 ${accent || 'text-[#9CA3AF]'}`} />
      </div>
      <p className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5]">{value}</p>
    </motion.div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    success: 'text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20',
    failed:  'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
    pending: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs border rounded-none font-medium ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}

function buildHourlyData(executions) {
  const byHour = {};
  executions.forEach((e) => {
    const h = new Date(e.created_at).getHours();
    const key = `${String(h).padStart(2, '0')}:00`;
    if (!byHour[key]) byHour[key] = { hour: key, total: 0, success: 0, failed: 0 };
    byHour[key].total += 1;
    if (e.status === 'success') byHour[key].success += 1;
    else if (e.status === 'failed') byHour[key].failed += 1;
  });
  return Object.values(byHour).sort((a, b) => a.hour.localeCompare(b.hour));
}

export default function MonitoringPage() {
  const [summary, setSummary]       = useState(null);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [days, setDays]             = useState('30');

  const refresh = useCallback(() => {
    Promise.all([
      api.get(`/monitoring/summary?days=${days}`),
      api.get('/workflows/executions?limit=50'),
    ])
      .then(([sum, execs]) => {
        setSummary(sum);
        setExecutions(execs.items || []);
        setLastRefresh(new Date());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const hourlyData   = buildHourlyData(executions);
  const totalExecs   = executions.length;
  const succeeded    = executions.filter((e) => e.status === 'success').length;
  const failed       = executions.filter((e) => e.status === 'failed').length;
  const rate         = totalExecs ? `${Math.round((succeeded / totalExecs) * 100)}%` : '—';

  const perUser      = summary?.per_user || [];
  const typeDistrib  = summary?.activity_type_dist || [];
  const recentRows   = summary?.recent_executions?.length ? summary.recent_executions : executions;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Monitor className="w-6 h-6 text-[#FF4500]" />
          <div>
            <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5]">Monitoring</h1>
            <p className="text-[#9CA3AF] text-sm">Live execution metrics — auto-refreshes every 15 seconds.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36 bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm focus:ring-[#FF4500]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
              {DAY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="focus:bg-[#1f2022]">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {lastRefresh && (
            <span className="text-[#9CA3AF] text-xs hidden sm:block">
              {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <Button
            onClick={refresh}
            variant="outline"
            size="sm"
            className="border-[#1f2022] bg-transparent text-[#9CA3AF] hover:bg-[#1f2022] rounded-none h-9 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
      >
        <StatCard label="Today's Runs"  value={summary?.workflows_today ?? '—'} icon={TrendingUp}  accent="text-[#FF4500]" />
        <StatCard label="Success Rate"  value={summary?.success_rate != null ? `${summary.success_rate}%` : rate} icon={CheckCircle} accent="text-[#22c55e]" />
        <StatCard label="Failures"      value={failed}    icon={XCircle}   accent="text-[#ef4444]" />
        <StatCard label="Total (shown)" value={totalExecs} icon={Clock}    accent="text-[#9CA3AF]" />
      </motion.div>

      {/* Charts row */}
      {hourlyData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          <div className="bg-[#141416] border border-[#1f2022] p-5">
            <p className="text-[#9CA3AF] text-xs uppercase tracking-wider font-medium mb-4">Executions by Hour</p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2022" />
                <XAxis dataKey="hour" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="total" stroke="#FF4500" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {typeDistrib.length > 0 ? (
            <div className="bg-[#141416] border border-[#1f2022] p-5">
              <p className="text-[#9CA3AF] text-xs uppercase tracking-wider font-medium mb-4">Activity Type Distribution</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={typeDistrib} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2022" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis dataKey="type" type="category" width={90} tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="count" radius={0}>
                    {typeDistrib.map((_, i) => (
                      <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="bg-[#141416] border border-[#1f2022] p-5">
              <p className="text-[#9CA3AF] text-xs uppercase tracking-wider font-medium mb-4">Success vs Failure</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2022" />
                  <XAxis dataKey="hour" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="success" fill="#22c55e" radius={0} />
                  <Bar dataKey="failed"  fill="#ef4444" radius={0} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Per-user breakdown */}
      {perUser.length > 0 && (
        <div className="mb-8">
          <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-3">Per-User Breakdown</h2>
          <div className="bg-[#141416] border border-[#1f2022] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1f2022]">
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">User</th>
                  <th className="px-4 py-3 text-right text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Total</th>
                  <th className="px-4 py-3 text-right text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden md:table-cell">Success</th>
                  <th className="px-4 py-3 text-right text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden md:table-cell">Failed</th>
                  <th className="px-4 py-3 text-right text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Rate</th>
                </tr>
              </thead>
              <tbody>
                {perUser.map((u, i) => {
                  const uRate = u.total ? Math.round((u.success / u.total) * 100) : 0;
                  return (
                    <tr key={u.user_id || i} className="border-b border-[#1f2022] last:border-0 hover:bg-[#1f2022]/40 transition-colors">
                      <td className="px-4 py-3 text-[#F2F3F5] font-medium">{u.user || '—'}</td>
                      <td className="px-4 py-3 text-[#9CA3AF] text-xs text-right">{u.total}</td>
                      <td className="px-4 py-3 text-[#22c55e] text-xs text-right hidden md:table-cell">{u.success}</td>
                      <td className="px-4 py-3 text-[#ef4444] text-xs text-right hidden md:table-cell">{u.failed}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-medium ${uRate >= 80 ? 'text-[#22c55e]' : uRate >= 50 ? 'text-[#f59e0b]' : 'text-[#ef4444]'}`}>
                          {uRate}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent executions */}
      <div>
        <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-3">Recent Executions</h2>
        <div className="bg-[#141416] border border-[#1f2022] overflow-hidden">
          {recentRows.length === 0 ? (
            <div className="p-10 text-center text-[#9CA3AF] text-sm">No executions recorded yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1f2022]">
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">ID</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Workflow</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden md:table-cell">User</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden lg:table-cell">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((ex, i) => (
                  <tr key={ex.id || i} className="border-b border-[#1f2022] last:border-0 hover:bg-[#1f2022]/40 transition-colors">
                    <td className="px-4 py-3 text-[#9CA3AF] text-xs font-mono">{(ex.id || '').slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-[#F2F3F5] text-sm font-medium">{ex.workflow_id}</td>
                    <td className="px-4 py-3"><StatusBadge status={ex.status} /></td>
                    <td className="px-4 py-3 text-[#9CA3AF] text-xs hidden md:table-cell">
                      {ex.user_name || ex.user_id?.slice(0, 12) || '—'}
                    </td>
                    <td className="px-4 py-3 text-[#9CA3AF] text-xs hidden lg:table-cell">
                      {ex.created_at ? new Date(ex.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
