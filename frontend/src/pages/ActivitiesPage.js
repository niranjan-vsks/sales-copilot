import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ActivitySquare, Search, RefreshCw, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';

const ENTITY_OPTIONS = [
  { value: 'phonecalls',   label: 'Phone Calls' },
  { value: 'tasks',        label: 'Tasks' },
  { value: 'emails',       label: 'Emails' },
  { value: 'appointments', label: 'Meetings' },
];

const STAT_VARIANTS = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

function StatCard({ label, value, sub }) {
  return (
    <motion.div
      variants={STAT_VARIANTS}
      className="bg-[#141416] border border-[#1f2022] p-5"
    >
      <p className="text-[#9CA3AF] text-xs uppercase tracking-wider font-medium mb-2">{label}</p>
      <p className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5]">{value}</p>
      {sub && <p className="text-[#9CA3AF] text-xs mt-1">{sub}</p>}
    </motion.div>
  );
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entitySet, setEntitySet] = useState('phonecalls');
  const [executions, setExecutions] = useState([]);
  const [d365OrgUrl, setD365OrgUrl] = useState('');

  const loadActivities = useCallback(() => {
    setLoading(true);
    api.get(`/d365/activities?entity_set=${entitySet}&top=50`)
      .then((data) => setActivities(Array.isArray(data) ? data : []))
      .catch(() => setActivities([]))
      .finally(() => setLoading(false));
  }, [entitySet]);

  useEffect(() => {
    loadActivities();
    api.get('/workflows/executions?limit=100&workflow_id=log-d365-activity')
      .then((d) => setExecutions(d.items || []))
      .catch(() => {});
    api.get('/config')
      .then((cfg) => setD365OrgUrl(cfg.d365_org_url || ''))
      .catch(() => {});
  }, [loadActivities]);

  const filtered = activities.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (a.subject || '').toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q)
    );
  });

  const successCount = executions.filter((e) => e.status === 'success').length;
  const successRate = executions.length ? Math.round((successCount / executions.length) * 100) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ActivitySquare className="w-6 h-6 text-[#FF4500]" />
        <div>
          <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5]">Activities</h1>
          <p className="text-[#9CA3AF] text-sm">D365 activity history and execution log.</p>
        </div>
      </div>

      {/* Stat cards */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
      >
        <StatCard label="Total Logged" value={executions.length} sub="via Sales Copilot" />
        <StatCard
          label="This Week"
          value={executions.filter((e) => {
            const d = new Date(e.created_at);
            const now = new Date();
            const dayMs = 7 * 24 * 60 * 60 * 1000;
            return now - d < dayMs;
          }).length}
          sub="last 7 days"
        />
        <StatCard label="Success Rate" value={`${successRate}%`} sub={`${successCount} succeeded`} />
        <StatCard label="In D365" value={activities.length} sub={`${entitySet} records`} />
      </motion.div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <Input
            data-testid="activities-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activities..."
            className="pl-9 bg-[#141416] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-9 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
          />
        </div>
        <Select value={entitySet} onValueChange={setEntitySet}>
          <SelectTrigger
            data-testid="select-entity-type"
            className="w-40 bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm focus:ring-[#FF4500]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
            {ENTITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="focus:bg-[#1f2022]">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          data-testid="btn-refresh-activities"
          onClick={loadActivities}
          variant="outline"
          size="sm"
          className="border-[#1f2022] bg-transparent text-[#9CA3AF] hover:bg-[#1f2022] rounded-none h-9 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Table */}
      <div className="bg-[#141416] border border-[#1f2022] overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-[#9CA3AF] text-sm">Loading activities...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-[#9CA3AF] text-sm">
            {search ? 'No matching activities found.' : 'No activities logged yet. Run the Log D365 Activity workflow to get started.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1f2022]">
                <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Subject</th>
                <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden md:table-cell">Duration</th>
                <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden lg:table-cell">Created</th>
                <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Link</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => {
                const recId = a.activityid || a.activityId;
                const d365Url = recId && d365OrgUrl
                  ? `${d365OrgUrl}/main.aspx?etn=${entitySet.slice(0,-1)}&id=${recId}&pagetype=entityrecord`
                  : null;
                return (
                  <tr key={recId || i} className="border-b border-[#1f2022] last:border-0 hover:bg-[#1f2022]/40 transition-colors">
                    <td className="px-4 py-3 text-[#F2F3F5] font-medium max-w-xs truncate">
                      {a.subject || '(no subject)'}
                    </td>
                    <td className="px-4 py-3 text-[#9CA3AF] text-xs hidden md:table-cell">
                      {a.actualdurationminutes ? `${a.actualdurationminutes} min` : '—'}
                    </td>
                    <td className="px-4 py-3 text-[#9CA3AF] text-xs hidden lg:table-cell">
                      {a.createdon ? new Date(a.createdon).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {d365Url ? (
                        <a
                          href={d365Url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[#FF4500] text-xs hover:underline"
                        >
                          D365 <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-[#9CA3AF] text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-3 text-[#9CA3AF] text-xs">
        Showing {filtered.length} of {activities.length} {entitySet} from Dynamics 365.
      </p>
    </div>
  );
}
