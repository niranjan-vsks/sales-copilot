import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ClipboardList, Mail, Search, Calendar, FileText, Bell,
  Play, ExternalLink, Bookmark,
} from 'lucide-react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

// ── Workflow cards ──────────────────────────────────────────────────────────
const WORKFLOW_CARDS = [
  {
    id: 'log-d365-activity',
    name: 'Log D365 Activity',
    description: 'Auto-create phone calls, tasks and interactions directly in Dynamics 365.',
    icon: ClipboardList,
    status: 'live',
  },
  {
    id: 'sync-emails',
    name: 'Sync Emails',
    description: 'Sync Outlook emails with D365 contact records automatically.',
    icon: Mail,
    status: 'coming_soon',
  },
  {
    id: 'search-leads',
    name: 'Search Leads',
    description: 'Find qualified leads using AI-powered prospecting.',
    icon: Search,
    status: 'coming_soon',
  },
  {
    id: 'update-calendar',
    name: 'Update Calendar',
    description: 'Sync meetings between Outlook Calendar and D365.',
    icon: Calendar,
    status: 'coming_soon',
  },
  {
    id: 'process-files',
    name: 'Process Files',
    description: 'Extract and log data from uploaded documents.',
    icon: FileText,
    status: 'coming_soon',
  },
  {
    id: 'alert-notifications',
    name: 'Alert Notifications',
    description: 'Get notified of key CRM events and opportunities.',
    icon: Bell,
    status: 'coming_soon',
  },
];

// ── Form schema ──────────────────────────────────────────────────────────────
const activitySchema = z.object({
  activity_type: z.enum(['phonecall', 'task', 'email', 'appointment']),
  account: z.string().min(1, 'Account is required'),
  duration_minutes: z.coerce.number().min(1, 'Duration is required'),
  notes: z.string().max(500).optional(),
});

// ── Stagger variants ─────────────────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};
const cardVariants = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

// ── Status badge ─────────────────────────────────────────────────────────────
function ExecStatusBadge({ status }) {
  const map = {
    success: 'text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20',
    failed:  'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
    pending: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs border rounded-none font-medium ${map[status] || map.pending}`}>
      {status}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [executions, setExecutions] = useState([]);
  const [execLoading, setExecLoading] = useState(true);

  const { register, handleSubmit, formState: { errors }, setValue, watch, reset } = useForm({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      activity_type: 'phonecall',
      duration_minutes: 30,
      notes: '',
    },
  });

  const loadExecutions = useCallback(() => {
    api.get('/workflows/executions?limit=10')
      .then((data) => setExecutions(data.items || []))
      .catch(() => {})
      .finally(() => setExecLoading(false));
  }, []);

  useEffect(() => {
    api.get('/auth/me').then(setUser).catch(() => {});
    loadExecutions();
  }, [loadExecutions]);

  const openDialog = () => {
    reset();
    setDialogOpen(true);
  };

  const onSubmit = async (values) => {
    setSubmitting(true);
    try {
      const result = await api.post('/workflows/execute', {
        workflow_id: 'log-d365-activity',
        params: values,
      });
      toast.success('Activity logged in D365', {
        description: result.d365_record_url
          ? 'Record created successfully.'
          : 'Activity recorded.',
        action: result.d365_record_url
          ? { label: 'View in D365', onClick: () => window.open(result.d365_record_url, '_blank') }
          : undefined,
      });
      setDialogOpen(false);
      loadExecutions();
    } catch (err) {
      toast.error('Failed to log activity', { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const watchedValues = watch();
  const greeting = user
    ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}`
    : 'Dashboard';

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5] mb-1">
          {greeting}
        </h1>
        <p className="text-[#9CA3AF] text-sm">
          Your Dynamics 365 workflows, ready to run.
        </p>
      </div>

      {/* Workflow cards grid */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10"
      >
        {WORKFLOW_CARDS.map(({ id, name, description, icon: Icon, status }) => (
          <motion.div
            key={id}
            variants={cardVariants}
            whileHover={{ y: -3, boxShadow: '0 8px 30px rgba(255,69,0,0.15)' }}
            className="relative bg-[#141416] border border-[#1f2022] p-5 flex flex-col transition-shadow"
          >
            {status === 'coming_soon' && (
              <Badge className="absolute top-3 right-3 bg-[#1f2022] text-[#9CA3AF] border-[#1f2022] rounded-none text-[10px] font-medium px-2 py-0.5 hover:bg-[#1f2022]">
                Coming Soon
              </Badge>
            )}

            <div className="flex items-start gap-4 mb-4">
              <div className={`w-10 h-10 flex items-center justify-center shrink-0 ${
                status === 'live'
                  ? 'bg-[#FF4500]/10 border border-[#FF4500]/20 text-[#FF4500]'
                  : 'bg-[#1f2022] border border-[#1f2022] text-[#9CA3AF]'
              }`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-['Space_Grotesk'] text-[#F2F3F5] font-semibold text-sm mb-1">
                  {name}
                </h3>
                <p className="text-[#9CA3AF] text-xs leading-relaxed">{description}</p>
              </div>
            </div>

            <div className="mt-auto">
              {status === 'live' ? (
                <Button
                  data-testid={`run-workflow-${id}`}
                  onClick={openDialog}
                  size="sm"
                  className="w-full bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 text-xs font-medium transition-colors"
                >
                  <Play className="w-3 h-3 mr-1.5" /> Run
                </Button>
              ) : (
                <Button
                  disabled
                  size="sm"
                  className="w-full bg-transparent border border-[#1f2022] text-[#9CA3AF] rounded-none h-8 text-xs font-medium cursor-not-allowed opacity-50"
                >
                  Not available yet
                </Button>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Recent executions */}
      <div>
        <h2 className="font-['Space_Grotesk'] text-lg font-semibold text-[#F2F3F5] mb-4">
          Recent Executions
        </h2>
        {execLoading ? (
          <div className="text-[#9CA3AF] text-sm">Loading...</div>
        ) : executions.length === 0 ? (
          <div className="bg-[#141416] border border-[#1f2022] p-8 text-center text-[#9CA3AF] text-sm">
            No executions yet. Run your first workflow above.
          </div>
        ) : (
          <div className="bg-[#141416] border border-[#1f2022] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1f2022]">
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Workflow</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden md:table-cell">D365 Record</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden lg:table-cell">Time</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((ex) => (
                  <tr key={ex.id} className="border-b border-[#1f2022] last:border-0 hover:bg-[#1f2022]/40 transition-colors">
                    <td className="px-4 py-3 text-[#F2F3F5] font-medium">{ex.workflow_id}</td>
                    <td className="px-4 py-3"><ExecStatusBadge status={ex.status} /></td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {ex.d365_record_id ? (
                        ex.result?.record_url ? (
                          <a
                            href={ex.result.record_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[#FF4500] text-xs hover:underline"
                          >
                            View <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-[#9CA3AF] text-xs font-mono">{ex.d365_record_id.slice(0, 8)}…</span>
                        )
                      ) : (
                        <span className="text-[#9CA3AF] text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#9CA3AF] text-xs hidden lg:table-cell">
                      {ex.created_at ? new Date(ex.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── D365 Activity Logger Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          data-testid="d365-logger-dialog"
          className="bg-[#141416] border border-[#1f2022] text-[#F2F3F5] max-w-[480px] rounded-none p-0 gap-0"
        >
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-[#1f2022]">
            <div className="flex items-center gap-3 mb-1">
              <ClipboardList className="w-5 h-5 text-[#FF4500]" />
              <DialogTitle className="font-['Space_Grotesk'] text-lg font-bold text-[#F2F3F5]">
                Log D365 Activity
              </DialogTitle>
            </div>
            <DialogDescription className="text-[#9CA3AF] text-sm">
              Create a new activity record directly in Dynamics 365.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
            {/* Activity Type */}
            <div>
              <Label htmlFor="activity_type" className="text-xs text-[#9CA3AF] mb-1.5 block">
                Activity Type
              </Label>
              <Select
                onValueChange={(v) => setValue('activity_type', v)}
                defaultValue="phonecall"
              >
                <SelectTrigger
                  data-testid="select-activity-type"
                  className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm focus:ring-[#FF4500] focus:border-[#FF4500]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                  <SelectItem value="phonecall" className="focus:bg-[#1f2022]">Phone Call</SelectItem>
                  <SelectItem value="task"      className="focus:bg-[#1f2022]">Task</SelectItem>
                  <SelectItem value="email"     className="focus:bg-[#1f2022]">Email</SelectItem>
                  <SelectItem value="appointment" className="focus:bg-[#1f2022]">Meeting</SelectItem>
                </SelectContent>
              </Select>
              {errors.activity_type && (
                <p className="text-xs text-[#ef4444] mt-1">{errors.activity_type.message}</p>
              )}
            </div>

            {/* Account */}
            <div>
              <Label htmlFor="account" className="text-xs text-[#9CA3AF] mb-1.5 block">
                Account / Company
              </Label>
              <Input
                {...register('account')}
                data-testid="input-account"
                placeholder="e.g. Acme Corp"
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-9 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
              />
              {errors.account && (
                <p className="text-xs text-[#ef4444] mt-1">{errors.account.message}</p>
              )}
            </div>

            {/* Duration */}
            <div>
              <Label htmlFor="duration_minutes" className="text-xs text-[#9CA3AF] mb-1.5 block">
                Duration
              </Label>
              <Select
                onValueChange={(v) => setValue('duration_minutes', parseInt(v, 10))}
                defaultValue="30"
              >
                <SelectTrigger
                  data-testid="select-duration"
                  className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm focus:ring-[#FF4500] focus:border-[#FF4500]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                  {[15, 30, 45, 60, 90, 120].map((m) => (
                    <SelectItem key={m} value={String(m)} className="focus:bg-[#1f2022]">
                      {m} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.duration_minutes && (
                <p className="text-xs text-[#ef4444] mt-1">{errors.duration_minutes.message}</p>
              )}
            </div>

            {/* Notes */}
            <div>
              <Label htmlFor="notes" className="text-xs text-[#9CA3AF] mb-1.5 block">
                Notes <span className="text-[#9CA3AF]/50">(optional)</span>
              </Label>
              <Textarea
                {...register('notes')}
                data-testid="input-notes"
                placeholder="Key discussion points, next steps..."
                rows={3}
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none text-sm resize-none focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
              />
            </div>

            {/* Saved values preview (Save as Template trigger) */}
            {(watchedValues.account || watchedValues.notes) && (
              <div className="flex flex-wrap gap-2">
                {watchedValues.account && (
                  <span className="bg-[#1f2022] text-[#9CA3AF] text-xs px-2 py-1">
                    {watchedValues.account}
                  </span>
                )}
                {watchedValues.duration_minutes && (
                  <span className="bg-[#1f2022] text-[#9CA3AF] text-xs px-2 py-1">
                    {watchedValues.duration_minutes} min
                  </span>
                )}
                {watchedValues.notes && (
                  <span className="bg-[#1f2022] text-[#9CA3AF] text-xs px-2 py-1">
                    {String(watchedValues.notes).slice(0, 60)}{String(watchedValues.notes).length > 60 ? '…' : ''}
                  </span>
                )}
              </div>
            )}

            {/* Footer buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-[#1f2022]">
              <Button
                type="button"
                data-testid="btn-save-template"
                variant="ghost"
                size="sm"
                className="text-[#9CA3AF] border border-[#1f2022] hover:bg-[#1f2022] rounded-none text-xs h-8 gap-1.5 transition-colors"
                onClick={() => toast.info('Save as Template coming in Phase 2')}
              >
                <Bookmark className="w-3.5 h-3.5" />
                Save as Template
              </Button>

              <div className="flex gap-2">
                <Button
                  type="button"
                  data-testid="btn-cancel-dialog"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDialogOpen(false)}
                  className="text-[#9CA3AF] border border-[#1f2022] hover:bg-[#1f2022] rounded-none text-xs h-8 transition-colors"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-testid="btn-submit-activity"
                  size="sm"
                  disabled={submitting}
                  className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none text-xs h-8 px-4 transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Logging…' : 'Log Activity'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
