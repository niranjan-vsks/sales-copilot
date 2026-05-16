import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ClipboardList, Mail, Search, Calendar, FileText, Bell,
  Play, ExternalLink, ChevronDown, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import api from '@/lib/api';
import AccountSearchInput from '@/components/AccountSearchInput';

// ── Workflow cards ────────────────────────────────────────────────────────────
const WORKFLOW_CARDS = [
  { id: 'log-d365-activity',   name: 'Log D365 Activity',   description: 'Auto-create phone calls, tasks and interactions directly in Dynamics 365.', icon: ClipboardList, status: 'live' },
  { id: 'sync-emails',         name: 'Sync Emails',         description: 'Sync Outlook emails with D365 contact records automatically.',               icon: Mail,          status: 'coming_soon' },
  { id: 'search-leads',        name: 'Search Leads',        description: 'Find qualified leads using AI-powered prospecting.',                         icon: Search,        status: 'coming_soon' },
  { id: 'update-calendar',     name: 'Update Calendar',     description: 'Sync meetings between Outlook Calendar and D365.',                           icon: Calendar,      status: 'coming_soon' },
  { id: 'process-files',       name: 'Process Files',       description: 'Extract and log data from uploaded documents.',                              icon: FileText,      status: 'live',        route: '/admin/file-management' },
  { id: 'alert-notifications', name: 'Alert Notifications', description: 'Get notified of key CRM events and opportunities.',                          icon: Bell,          status: 'coming_soon' },
];

// ── Field visibility rules per activity type ─────────────────────────────────
const FIELD_CONFIG = {
  phonecall:   { showStartTime: true,  showLocation: true,  showTeams: false, showDuration: true  },
  task:        { showStartTime: true,  showLocation: false, showTeams: false, showDuration: true  },
  appointment: { showStartTime: true,  showLocation: true,  showTeams: true,  showDuration: true  },
};

// ── Form schema ───────────────────────────────────────────────────────────────
const activitySchema = z.object({
  activity_type:     z.enum(['phonecall', 'task', 'appointment']),
  subject:           z.string().min(1, 'Subject is required'),
  account:           z.string().min(1, 'Account is required'),
  activity_sub_type: z.string().optional(),
  duration_minutes:  z.coerce.number().min(1, 'Duration is required'),
  start_time:        z.string().optional(),
  location:          z.string().optional(),
  teams_meeting:     z.boolean().default(false),
  primary_attendee:  z.string().optional(),
  other_attendees:   z.string().optional(),
  business_partner:  z.string().optional(),
  customer_attendee: z.string().optional(),
  action_owners:     z.string().optional(),
  partner_attendee:  z.string().optional(),
  notes:             z.string().max(1000).optional(),
});

// ── Animations ────────────────────────────────────────────────────────────────
const containerVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const cardVariants = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

// ── Status badge ──────────────────────────────────────────────────────────────
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

// ── Shared input class ────────────────────────────────────────────────────────
const INPUT_CLS = 'bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-9 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]';

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser]               = useState(null);
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [executions, setExecutions]   = useState([]);
  const [execLoading, setExecLoading] = useState(true);
  const [peopleOpen, setPeopleOpen]   = useState(false);
  const [detailOpen, setDetailOpen]   = useState(false);
  const [selectedExec, setSelectedExec] = useState(null);
  const [mdmIds, setMdmIds]           = useState({ idg: '', isg: '' });

  const { register, handleSubmit, formState: { errors }, setValue, watch, reset } = useForm({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      activity_type: 'appointment',
      duration_minutes: 30,
      teams_meeting: false,
      notes: '',
    },
  });

  const fieldCfg = FIELD_CONFIG[watch('activity_type')] || FIELD_CONFIG.appointment;

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
    reset({ activity_type: 'appointment', duration_minutes: 30, teams_meeting: false });
    setPeopleOpen(false);
    setMdmIds({ idg: '', isg: '' });
    setDialogOpen(true);
  };

  const openDetail = (ex) => {
    setSelectedExec(ex);
    setDetailOpen(true);
  };

  const onSubmit = async (values) => {
    setSubmitting(true);
    try {
      const result = await api.post('/workflows/execute', {
        workflow_id: 'log-d365-activity',
        params: { ...values, mdm_id: mdmIds.idg || mdmIds.isg || '' },
      });

      if (result.status === 'success' && result.d365_record_url) {
        toast.success('Activity confirmed in D365', {
          description: 'Record created and verified.',
          action: { label: 'View in D365', onClick: () => window.open(result.d365_record_url, '_blank') },
        });
      } else if (result.status === 'pending') {
        toast.info('Activity submitted', {
          description: 'Webhook accepted. Update Power Automate to return the record ID for full confirmation.',
        });
      } else {
        toast.success('Activity logged', { description: 'Activity recorded.' });
      }
      setDialogOpen(false);
      loadExecutions();
    } catch (err) {
      toast.error('Failed to log activity', { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const greeting = user
    ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}`
    : 'Dashboard';

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5] mb-1">{greeting}</h1>
        <p className="text-[#9CA3AF] text-sm">Your Dynamics 365 workflows, ready to run.</p>
      </div>

      {/* Workflow cards */}
      <motion.div
        variants={containerVariants} initial="hidden" animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10"
      >
        {WORKFLOW_CARDS.map(({ id, name, description, icon: Icon, status, route }) => (
          <motion.div
            key={id} variants={cardVariants}
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
                <h3 className="font-['Space_Grotesk'] text-[#F2F3F5] font-semibold text-sm mb-1">{name}</h3>
                <p className="text-[#9CA3AF] text-xs leading-relaxed">{description}</p>
              </div>
            </div>
            <div className="mt-auto">
              {status === 'live' ? (
                <Button onClick={route ? () => navigate(route) : openDialog} size="sm"
                  className="w-full bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 text-xs font-medium transition-colors">
                  <Play className="w-3 h-3 mr-1.5" /> Run
                </Button>
              ) : (
                <Button disabled size="sm"
                  className="w-full bg-transparent border border-[#1f2022] text-[#9CA3AF] rounded-none h-8 text-xs font-medium cursor-not-allowed opacity-50">
                  Not available yet
                </Button>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Recent executions */}
      <div>
        <h2 className="font-['Space_Grotesk'] text-lg font-semibold text-[#F2F3F5] mb-4">Recent Executions</h2>
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
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Subject</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden md:table-cell">D365 Record</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden lg:table-cell">Time</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((ex) => (
                  <tr
                    key={ex.id}
                    onClick={() => openDetail(ex)}
                    className="border-b border-[#1f2022] last:border-0 hover:bg-[#1f2022]/40 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 text-[#F2F3F5] font-medium max-w-[200px] truncate">
                      {ex.params?.subject || ex.workflow_id}
                    </td>
                    <td className="px-4 py-3"><ExecStatusBadge status={ex.status} /></td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {ex.d365_record_id ? (
                        ex.result?.record_url ? (
                          <a
                            href={ex.result.record_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
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

      {/* ── D365 Activity Logger Dialog ─────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className="bg-[#141416] border border-[#1f2022] text-[#F2F3F5] max-w-[620px] rounded-none p-0 gap-0"
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

          <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-5 overflow-y-auto max-h-[70vh]">

            {/* ── Activity Details ── */}
            <div className="space-y-4">
              <p className="text-[#9CA3AF] text-[11px] uppercase tracking-wider font-medium">Activity Details</p>

              {/* Subject */}
              <div>
                <Label className="text-xs text-[#9CA3AF] mb-1.5 block">
                  Subject <span className="text-[#ef4444]">*</span>
                </Label>
                <Input
                  {...register('subject')}
                  placeholder="e.g. QBR with Acme Corp — Q1 Review"
                  className={INPUT_CLS}
                />
                {errors.subject && <p className="text-xs text-[#ef4444] mt-1">{errors.subject.message}</p>}
              </div>

              {/* Activity Type + Sub-Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Activity Type</Label>
                  <Select onValueChange={(v) => setValue('activity_type', v)} defaultValue="appointment">
                    <SelectTrigger
                      className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm focus:ring-[#FF4500] focus:border-[#FF4500]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                      <SelectItem value="phonecall" disabled className="focus:bg-[#1f2022] opacity-40 cursor-not-allowed">Phone Call</SelectItem>
                      <SelectItem value="task"      disabled className="focus:bg-[#1f2022] opacity-40 cursor-not-allowed">Task</SelectItem>
                      <SelectItem value="appointment"        className="focus:bg-[#1f2022]">Appointment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">
                    Sub-Type <span className="text-[#9CA3AF]/50">(optional)</span>
                  </Label>
                  <Input
                    {...register('activity_sub_type')}
                    placeholder="e.g. Discovery, QBR, Follow-up"
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              {/* Account / Regarding */}
              <div>
                <Label className="text-xs text-[#9CA3AF] mb-1.5 block">
                  Account / Regarding <span className="text-[#ef4444]">*</span>
                </Label>
                <AccountSearchInput
                  value={watch('account') || ''}
                  onChange={({ name, mdm_id_idg, mdm_id_isg }) => {
                    setValue('account', name, { shouldValidate: true });
                    setMdmIds({ idg: mdm_id_idg, isg: mdm_id_isg });
                  }}
                  placeholder="Search or type account name…"
                />
                {errors.account && <p className="text-xs text-[#ef4444] mt-1">{errors.account.message}</p>}
              </div>

              {/* MDM ID (read-only, auto-populated from account search) */}
              <div>
                <Label className="text-xs text-[#9CA3AF] mb-1.5 block">MDM ID <span className="text-[#9CA3AF]/50">(auto-filled on selection)</span></Label>
                <Input
                  readOnly
                  value={mdmIds.idg || mdmIds.isg || ''}
                  placeholder="Select an account above to auto-fill"
                  className={`${INPUT_CLS} cursor-default opacity-70`}
                />
              </div>
            </div>

            {/* ── Schedule ── */}
            {(fieldCfg.showStartTime || fieldCfg.showDuration) && (
            <div className="space-y-3">
              <p className="text-[#9CA3AF] text-[11px] uppercase tracking-wider font-medium">Schedule</p>

              <div className="grid grid-cols-2 gap-3">
                {/* Start Date & Time */}
                {fieldCfg.showStartTime && (
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">
                    {watch('activity_type') === 'task' ? 'Due Date & Time' : 'Start Date & Time'}
                  </Label>
                  <Input
                    {...register('start_time')}
                    type="datetime-local"
                    className={`${INPUT_CLS} [color-scheme:dark]`}
                  />
                </div>
                )}
                {/* Duration */}
                {fieldCfg.showDuration && (
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Duration</Label>
                  <Select
                    onValueChange={(v) => setValue('duration_minutes', parseInt(v, 10))}
                    defaultValue="30"
                  >
                    <SelectTrigger
                      className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm focus:ring-[#FF4500] focus:border-[#FF4500]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                      {[15, 30, 45, 60, 90, 120].map((m) => (
                        <SelectItem key={m} value={String(m)} className="focus:bg-[#1f2022]">
                          {m} min
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                )}
              </div>

              {(fieldCfg.showLocation || fieldCfg.showTeams) && (
              <div className="grid grid-cols-2 gap-3">
                {/* Location */}
                {fieldCfg.showLocation && (
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Location</Label>
                  <Input
                    {...register('location')}
                    placeholder="Room, city, or online"
                    className={INPUT_CLS}
                  />
                </div>
                )}
                {/* Teams Meeting */}
                {fieldCfg.showTeams && (
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Teams Meeting</Label>
                  <div className="flex items-center h-9 gap-2.5">
                    <Switch
                      checked={!!watch('teams_meeting')}
                      onCheckedChange={(v) => setValue('teams_meeting', v)}
                    />
                    <span className="text-[#9CA3AF] text-xs">
                      {watch('teams_meeting') ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
                )}
              </div>
              )}
            </div>
            )}

            {/* ── People & Attendees (collapsible) ── */}
            <Collapsible open={peopleOpen} onOpenChange={setPeopleOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 w-full group">
                {peopleOpen
                  ? <ChevronDown className="w-3 h-3 text-[#9CA3AF]" />
                  : <ChevronRight className="w-3 h-3 text-[#9CA3AF]" />
                }
                <span className="text-[#9CA3AF] text-[11px] uppercase tracking-wider font-medium group-hover:text-[#F2F3F5] transition-colors">
                  People & Attendees
                </span>
                <span className="text-[#9CA3AF]/50 text-[10px] normal-case tracking-normal">
                  (optional)
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Primary Lenovo Attendee</Label>
                    <Input {...register('primary_attendee')} placeholder="Name or email" className={INPUT_CLS} />
                  </div>
                  <div>
                    <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Other Lenovo Attendees</Label>
                    <Input {...register('other_attendees')} placeholder="Comma-separated" className={INPUT_CLS} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Business Partner</Label>
                    <Input {...register('business_partner')} placeholder="Partner name" className={INPUT_CLS} />
                  </div>
                  <div>
                    <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Customer Attendee</Label>
                    <Input {...register('customer_attendee')} placeholder="Customer contact" className={INPUT_CLS} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Action Owners</Label>
                    <Input {...register('action_owners')} placeholder="Name or email" className={INPUT_CLS} />
                  </div>
                  <div>
                    <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Partner Attendee</Label>
                    <Input {...register('partner_attendee')} placeholder="Partner contact" className={INPUT_CLS} />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* ── Notes ── */}
            <div>
              <Label className="text-xs text-[#9CA3AF] mb-1.5 block">
                Notes <span className="text-[#9CA3AF]/50">(optional)</span>
              </Label>
              <Textarea
                {...register('notes')}
                placeholder="Key discussion points, next steps, action items..."
                rows={3}
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none text-sm resize-none focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1f2022]">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDialogOpen(false)}
                className="text-[#9CA3AF] border border-[#1f2022] hover:bg-[#1f2022] rounded-none text-xs h-8 transition-colors"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none text-xs h-8 px-4 transition-colors disabled:opacity-60"
              >
                {submitting ? 'Logging…' : 'Log Activity'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Execution Detail Dialog ─────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-[#141416] border border-[#1f2022] text-[#F2F3F5] max-w-[520px] rounded-none p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-[#1f2022]">
            <div className="flex items-center justify-between">
              <DialogTitle className="font-['Space_Grotesk'] text-base font-bold text-[#F2F3F5]">
                Execution Detail
              </DialogTitle>
              {selectedExec && <ExecStatusBadge status={selectedExec.status} />}
            </div>
          </DialogHeader>

          {selectedExec && (
            <div className="px-6 py-5 space-y-4 overflow-y-auto max-h-[65vh]">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-[#9CA3AF] text-[10px] uppercase tracking-wider mb-0.5">Time</p>
                  <p className="text-[#F2F3F5] text-xs">{new Date(selectedExec.created_at).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-[10px] uppercase tracking-wider mb-0.5">Method</p>
                  <p className="text-[#F2F3F5] text-xs">{selectedExec.result?.method || '—'}</p>
                </div>
              </div>

              {/* D365 record link */}
              {selectedExec.d365_record_id && (
                <div>
                  <p className="text-[#9CA3AF] text-[10px] uppercase tracking-wider mb-1">D365 Record</p>
                  {selectedExec.result?.record_url ? (
                    <a
                      href={selectedExec.result.record_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[#FF4500] text-xs hover:underline"
                    >
                      Open in Dynamics 365 <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <p className="text-[#F2F3F5] text-xs font-mono">{selectedExec.d365_record_id}</p>
                  )}
                </div>
              )}

              {/* Pending notice + raw PA response */}
              {selectedExec.status === 'pending' && (
                <div className="space-y-2">
                  <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/20 px-3 py-2.5">
                    <p className="text-[#f59e0b] text-xs leading-relaxed">
                      {selectedExec.result?.pending_reason ||
                        'Webhook accepted. No record ID returned — update Power Automate HTTP Response to include the activityid.'}
                    </p>
                  </div>
                  {selectedExec.result?.webhook_raw_response !== undefined && (
                    <div>
                      <p className="text-[#9CA3AF] text-[10px] uppercase tracking-wider mb-1">
                        Power Automate Response
                        {selectedExec.result?.webhook_http_status && (
                          <span className="ml-2 normal-case text-[#f59e0b]">
                            HTTP {selectedExec.result.webhook_http_status}
                          </span>
                        )}
                      </p>
                      <pre className="bg-[#0f0f10] border border-[#1f2022] px-3 py-2 text-[#9CA3AF] text-[11px] overflow-x-auto whitespace-pre-wrap break-all rounded-none">
                        {typeof selectedExec.result.webhook_raw_response === 'object'
                          ? JSON.stringify(selectedExec.result.webhook_raw_response, null, 2)
                          : String(selectedExec.result.webhook_raw_response)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {selectedExec.status === 'failed' && (
                <div className="space-y-2">
                  {selectedExec.error_message && (
                    <div className="bg-[#ef4444]/10 border border-[#ef4444]/20 px-3 py-2.5">
                      <p className="text-[#ef4444] text-xs">{selectedExec.error_message}</p>
                    </div>
                  )}
                  {selectedExec.result?.webhook_raw_response !== undefined && (
                    <div>
                      <p className="text-[#9CA3AF] text-[10px] uppercase tracking-wider mb-1">
                        Webhook Response
                        {selectedExec.result?.webhook_http_status && (
                          <span className="ml-2 normal-case text-[#ef4444]">
                            HTTP {selectedExec.result.webhook_http_status}
                          </span>
                        )}
                      </p>
                      <pre className="bg-[#0f0f10] border border-[#1f2022] px-3 py-2 text-[#9CA3AF] text-[11px] overflow-x-auto whitespace-pre-wrap break-all rounded-none">
                        {typeof selectedExec.result.webhook_raw_response === 'object'
                          ? JSON.stringify(selectedExec.result.webhook_raw_response, null, 2)
                          : String(selectedExec.result.webhook_raw_response)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Submitted data */}
              <div>
                <p className="text-[#9CA3AF] text-[10px] uppercase tracking-wider mb-2">Submitted Data</p>
                <div className="space-y-1.5">
                  {Object.entries(selectedExec.params || {}).map(([k, v]) =>
                    v !== undefined && v !== '' && v !== null && v !== false ? (
                      <div key={k} className="flex gap-2 text-xs">
                        <span className="text-[#9CA3AF] w-44 shrink-0 capitalize">{k.replace(/_/g, ' ')}</span>
                        <span className="text-[#F2F3F5] break-all">{String(v)}</span>
                      </div>
                    ) : null
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
