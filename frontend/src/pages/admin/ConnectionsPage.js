import { useEffect, useState } from 'react';
import {
  Settings, CheckCircle, XCircle, Loader2, PlugZap,
  Globe, Save, Trash2, HelpCircle, X, ChevronRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import api from '@/lib/api';

const CARD_VARIANTS = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function StatusPill({ connected }) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#22c55e] bg-[#22c55e]/10 border border-[#22c55e]/20 px-2.5 py-1">
      <CheckCircle className="w-3.5 h-3.5" /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/20 px-2.5 py-1">
      <XCircle className="w-3.5 h-3.5" /> Not connected
    </span>
  );
}

function InfoButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-[#9CA3AF] hover:text-[#F2F3F5] transition-colors ml-2 shrink-0"
      title="Setup guide"
    >
      <HelpCircle className="w-4 h-4" />
    </button>
  );
}

function HelpModal({ open, onClose, title, children }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#141416] border border-[#1f2022] text-[#F2F3F5] max-w-lg rounded-none p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-[#1f2022]">
          <div className="flex items-center justify-between">
            <DialogTitle className="font-['Space_Grotesk'] text-base font-bold text-[#F2F3F5]">
              {title}
            </DialogTitle>
            <button onClick={onClose} className="text-[#9CA3AF] hover:text-[#F2F3F5] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </DialogHeader>
        <div className="px-6 py-5 text-sm text-[#9CA3AF] space-y-3 leading-relaxed">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, children }) {
  return (
    <div className="flex gap-3">
      <span className="w-5 h-5 bg-[#FF4500]/20 border border-[#FF4500]/40 text-[#FF4500] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </span>
      <p className="text-[#9CA3AF] text-sm">{children}</p>
    </div>
  );
}

// ── CRM providers — UI shell for future expansion ────────────────────────────
const CRM_PROVIDERS = [
  { id: 'd365',       label: 'Dynamics 365',  active: true  },
  { id: 'salesforce', label: 'Salesforce',     active: false },
  { id: 'hubspot',    label: 'HubSpot',        active: false },
  { id: 'zoho',       label: 'Zoho CRM',       active: false },
];

export default function ConnectionsPage() {
  const [user, setUser] = useState(null);
  const [d365Status, setD365Status] = useState(null);
  const [testing, setTesting] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [settings, setSettings] = useState(null);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookStatus, setWebhookStatus] = useState(null);
  const [savingWebhook, setSavingWebhook] = useState(false);

  const [cookiesText, setCookiesText] = useState('');
  const [cookiesStatus, setCookiesStatus] = useState(null);
  const [savingCookies, setSavingCookies] = useState(false);

  // Help modals
  const [webhookHelp, setWebhookHelp] = useState(false);
  const [cookieHelp, setCookieHelp] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then(setUser).catch(() => {});
    api.get('/settings')
      .then((s) => { setSettings(s); setDryRun(!!s.dry_run_mode); })
      .catch(() => {});
    api.get('/d365/webhook/status').then(setWebhookStatus).catch(() => {});
    api.get('/d365/browser/status').then(setCookiesStatus).catch(() => {});
  }, []);

  const saveWebhook = async () => {
    if (webhookUrl && !webhookUrl.startsWith('https://')) {
      toast.error('Webhook URL must start with https://');
      return;
    }
    setSavingWebhook(true);
    try {
      await api.put('/d365/webhook/url', { url: webhookUrl });
      const updated = await api.get('/d365/webhook/status');
      setWebhookStatus(updated);
      toast.success(webhookUrl ? 'Webhook URL saved' : 'Webhook URL cleared');
      setWebhookUrl('');
    } catch (err) {
      toast.error('Failed to save webhook URL', { description: err.message });
    } finally {
      setSavingWebhook(false);
    }
  };

  const clearWebhook = async () => {
    setSavingWebhook(true);
    try {
      await api.put('/d365/webhook/url', { url: '' });
      setWebhookStatus(await api.get('/d365/webhook/status'));
      toast.success('Webhook URL cleared');
    } catch (err) {
      toast.error('Failed to clear webhook URL', { description: err.message });
    } finally {
      setSavingWebhook(false);
    }
  };

  const saveCookies = async () => {
    if (!cookiesText.trim()) { toast.error('Paste your session data first'); return; }
    setSavingCookies(true);
    try {
      await api.post('/d365/browser/save-cookies', { cookies_json: cookiesText.trim() });
      setCookiesStatus(await api.get('/d365/browser/status'));
      setCookiesText('');
      toast.success('Session credentials saved securely');
    } catch (err) {
      toast.error('Failed to save session data', { description: err.message });
    } finally {
      setSavingCookies(false);
    }
  };

  const testD365 = async () => {
    setTesting(true);
    setD365Status(null);
    try {
      const result = await api.get('/d365/test');
      setD365Status(result);
      if (result.connected) {
        toast.success('D365 connection verified', { description: `Org: ${result.org_id?.slice(0, 8)}…` });
      } else {
        toast.error('Connection failed', { description: result.error_message });
      }
    } catch (err) {
      setD365Status({ connected: false, error_message: err.message });
      toast.error('Connection test failed', { description: err.message });
    } finally {
      setTesting(false);
    }
  };

  const saveDryRun = async (val) => {
    setDryRun(val);
    try {
      await api.put('/settings', { dry_run_mode: val });
      toast.success(val ? 'Dry run mode enabled' : 'Dry run mode disabled');
    } catch {
      setDryRun(!val);
      toast.error('Failed to save setting');
    }
  };

  const d365OrgUrl = settings?.d365_org_url || process.env.REACT_APP_D365_ORG_URL || '';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Settings className="w-6 h-6 text-[#FF4500]" />
        <div>
          <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5]">Connections</h1>
          <p className="text-[#9CA3AF] text-sm">Manage your CRM and workflow integrations.</p>
        </div>
      </div>

      <motion.div
        initial="hidden" animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        className="space-y-4"
      >
        {/* ── CRM Provider ── */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6">
          <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-1">CRM Provider</h2>
          <p className="text-[#9CA3AF] text-sm mb-4">Your active CRM platform. Additional providers coming soon.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CRM_PROVIDERS.map(({ id, label, active }) => (
              <div
                key={id}
                className={`border px-3 py-2.5 text-sm text-center transition-colors ${
                  active
                    ? 'border-[#FF4500]/40 bg-[#FF4500]/8 text-[#FF4500] font-medium'
                    : 'border-[#1f2022] text-[#9CA3AF]/50 cursor-not-allowed'
                }`}
              >
                {label}
                {active && <span className="block text-[10px] text-[#FF4500]/70 mt-0.5">Active</span>}
                {!active && <span className="block text-[10px] mt-0.5">Soon</span>}
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Microsoft 365 ── */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-1">Microsoft 365</h2>
              <p className="text-[#9CA3AF] text-sm">Identity, Outlook, and Dynamics 365 access via Microsoft Entra ID.</p>
            </div>
            <StatusPill connected={!!user} />
          </div>
          {user && (
            <div className="bg-[#0f0f10] border border-[#1f2022] px-4 py-3 text-sm">
              <div className="flex gap-8 flex-wrap">
                <div>
                  <p className="text-[#9CA3AF] text-xs mb-0.5">Signed in as</p>
                  <p className="text-[#F2F3F5] font-medium">{user.name}</p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-xs mb-0.5">Email</p>
                  <p className="text-[#F2F3F5]">{user.email}</p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-xs mb-0.5">Role</p>
                  <Badge className="bg-[#FF4500]/10 text-[#FF4500] border-[#FF4500]/20 rounded-none text-xs">
                    {user.role}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* ── Dynamics 365 ── */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-1">Dynamics 365</h2>
              <p className="text-[#9CA3AF] text-sm">Direct Dataverse Web API — creates activity records in real time.</p>
            </div>
            {d365Status !== null && <StatusPill connected={d365Status.connected} />}
          </div>
          <div className="bg-[#0f0f10] border border-[#1f2022] px-4 py-3 mb-4">
            <p className="text-[#9CA3AF] text-xs mb-0.5">Organization URL</p>
            <p className="text-[#F2F3F5] text-sm font-mono break-all">{d365OrgUrl || 'Not configured'}</p>
          </div>
          <div className="flex items-center justify-between mb-5 py-3 border-t border-[#1f2022]">
            <div>
              <Label className="text-[#F2F3F5] text-sm font-medium">Dry Run Mode</Label>
              <p className="text-[#9CA3AF] text-xs mt-0.5">Validate without writing records to D365.</p>
            </div>
            <Switch checked={dryRun} onCheckedChange={saveDryRun} className="data-[state=checked]:bg-[#FF4500]" />
          </div>
          <Button
            onClick={testD365} disabled={testing}
            className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-9 px-5 text-sm transition-colors disabled:opacity-60"
          >
            {testing
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing…</>
              : <><PlugZap className="w-4 h-4 mr-2" /> Test Connection</>}
          </Button>
          {d365Status && !d365Status.connected && d365Status.error_message && (
            <p className="mt-3 text-xs text-[#ef4444]">{d365Status.error_message}</p>
          )}
        </motion.div>

        {/* ── Automation Webhook ── */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5]">Automation Webhook</h2>
                  <InfoButton onClick={() => setWebhookHelp(true)} />
                </div>
                <p className="text-[#9CA3AF] text-sm mt-1">
                  Connect a workflow automation to create activity records automatically.
                </p>
              </div>
            </div>
            {webhookStatus !== null && (
              <div className="ml-4 shrink-0"><StatusPill connected={webhookStatus.configured} /></div>
            )}
          </div>
          {webhookStatus?.configured && (
            <div className="bg-[#0f0f10] border border-[#1f2022] px-4 py-3 mb-4">
              <p className="text-[#9CA3AF] text-xs mb-0.5">Active endpoint</p>
              <p className="text-[#F2F3F5] text-sm font-mono break-all">{webhookStatus.url_preview}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://…"
              className="flex-1 bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm placeholder:text-[#9CA3AF]/50 focus-visible:ring-0 focus-visible:border-[#FF4500]"
            />
            <Button
              onClick={saveWebhook} disabled={savingWebhook || !webhookUrl}
              className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-9 px-4 text-sm transition-colors disabled:opacity-60 shrink-0"
            >
              {savingWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-1.5" /> Save</>}
            </Button>
            {webhookStatus?.configured && (
              <Button
                onClick={clearWebhook} disabled={savingWebhook}
                className="bg-transparent hover:bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/30 rounded-none h-9 px-3 text-sm transition-colors disabled:opacity-60 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </motion.div>

        {/* ── Extended Access ── */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5]">Extended Access</h2>
                  <InfoButton onClick={() => setCookieHelp(true)} />
                </div>
                <p className="text-[#9CA3AF] text-sm mt-1">
                  Alternative authentication for organizations with restricted access policies.
                </p>
              </div>
            </div>
            {cookiesStatus !== null && (
              <div className="ml-4 shrink-0"><StatusPill connected={cookiesStatus.configured} /></div>
            )}
          </div>
          {cookiesStatus?.configured && cookiesStatus.last_saved && (
            <div className="bg-[#0f0f10] border border-[#1f2022] px-4 py-3 mb-4">
              <p className="text-[#9CA3AF] text-xs mb-0.5">Last updated</p>
              <p className="text-[#F2F3F5] text-sm">{new Date(cookiesStatus.last_saved).toLocaleString()}</p>
            </div>
          )}
          <Textarea
            value={cookiesText}
            onChange={(e) => setCookiesText(e.target.value)}
            placeholder="Paste session credentials JSON here…"
            rows={4}
            className="w-full bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none text-sm font-mono placeholder:text-[#9CA3AF]/40 focus-visible:ring-0 focus-visible:border-[#FF4500] resize-none mb-3"
          />
          <div className="flex items-center justify-between">
            <Button
              onClick={saveCookies} disabled={savingCookies || !cookiesText.trim()}
              className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-9 px-5 text-sm transition-colors disabled:opacity-60"
            >
              {savingCookies
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                : <><Globe className="w-4 h-4 mr-2" /> Save Credentials</>}
            </Button>
            <p className="text-[#9CA3AF] text-xs">Encrypted and secure</p>
          </div>
        </motion.div>
      </motion.div>

      {/* ── Webhook Setup Guide modal ── */}
      <HelpModal open={webhookHelp} onClose={() => setWebhookHelp(false)} title="Webhook Setup Guide">
        <p className="text-[#F2F3F5] font-medium mb-3">Connect a Power Automate flow to automatically create records when activities are logged.</p>
        <div className="space-y-3">
          <Step n={1}>Open Power Automate and create a new Instant flow.</Step>
          <Step n={2}>Add the <strong className="text-[#F2F3F5]">When an HTTP request is received</strong> trigger.</Step>
          <Step n={3}>Add your Dynamics 365 action to create the activity record.</Step>
          <Step n={4}>In the HTTP Response action, return the record ID in the response body.</Step>
          <Step n={5}>Copy the HTTP POST URL from the trigger and paste it above.</Step>
        </div>
        <div className="mt-4 bg-[#0f0f10] border border-[#1f2022] px-3 py-2.5 text-xs font-mono text-[#9CA3AF]">
          {"{ \"activityid\": \"@{outputs('Create_record')?['body/activityid']}\" }"}
        </div>
      </HelpModal>

      {/* ── Extended Access Setup modal ── */}
      <HelpModal open={cookieHelp} onClose={() => setCookieHelp(false)} title="Extended Access Setup">
        <p className="text-[#F2F3F5] font-medium mb-3">Use this method when direct OAuth authentication is not available in your organization.</p>
        <div className="space-y-3">
          <Step n={1}>Open your Dynamics 365 environment in Chrome and sign in.</Step>
          <Step n={2}>Install the <strong className="text-[#F2F3F5]">Cookie-Editor</strong> Chrome extension.</Step>
          <Step n={3}>Click the extension icon, then <strong className="text-[#F2F3F5]">Export → Copy</strong>.</Step>
          <Step n={4}>Paste the copied JSON into the field above and click Save Credentials.</Step>
        </div>
        <p className="mt-3 text-[#9CA3AF]/70 text-xs">Session credentials expire periodically. Update them if authentication fails.</p>
      </HelpModal>
    </div>
  );
}
