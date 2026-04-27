import { useEffect, useState } from 'react';
import { Settings, CheckCircle, XCircle, Loader2, PlugZap, Globe, Save, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

export default function ConnectionsPage() {
  const [user, setUser] = useState(null);
  const [d365Status, setD365Status] = useState(null);
  const [testing, setTesting] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [settings, setSettings] = useState(null);

  // Power Automate webhook state
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookStatus, setWebhookStatus] = useState(null); // {configured, url_preview}
  const [savingWebhook, setSavingWebhook] = useState(false);

  // Browser cookie session state
  const [cookiesText, setCookiesText] = useState('');
  const [cookiesStatus, setCookiesStatus] = useState(null); // {configured, last_saved}
  const [savingCookies, setSavingCookies] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then(setUser).catch(() => {});
    api.get('/settings')
      .then((s) => { setSettings(s); setDryRun(!!s.dry_run_mode); })
      .catch(() => {});
    api.get('/d365/webhook/status')
      .then(setWebhookStatus)
      .catch(() => {});
    api.get('/d365/browser/status')
      .then(setCookiesStatus)
      .catch(() => {});
  }, []);

  const saveWebhook = async () => {
    if (webhookUrl && !webhookUrl.startsWith('https://')) {
      toast.error('Webhook URL must start with https://');
      return;
    }
    if (webhookStatus?.configured && webhookUrl) {
      toast.info('Replacing existing webhook URL with new one.');
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
      const updated = await api.get('/d365/webhook/status');
      setWebhookStatus(updated);
      toast.success('Webhook URL cleared');
    } catch (err) {
      toast.error('Failed to clear webhook URL', { description: err.message });
    } finally {
      setSavingWebhook(false);
    }
  };

  const saveCookies = async () => {
    if (!cookiesText.trim()) {
      toast.error('Paste your cookies JSON first');
      return;
    }
    setSavingCookies(true);
    try {
      await api.post('/d365/browser/save-cookies', { cookies_json: cookiesText.trim() });
      const updated = await api.get('/d365/browser/status');
      setCookiesStatus(updated);
      setCookiesText('');
      toast.success('Browser cookies saved and encrypted');
    } catch (err) {
      toast.error('Failed to save cookies', { description: err.message });
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
        toast.success('D365 connection successful', {
          description: `Org: ${result.org_id?.slice(0, 8)}…`,
        });
      } else {
        toast.error('D365 connection failed', { description: result.error_message });
      }
    } catch (err) {
      setD365Status({ connected: false, error_message: err.message });
      toast.error('D365 test failed', { description: err.message });
    } finally {
      setTesting(false);
    }
  };

  const saveDryRun = async (val) => {
    setDryRun(val);
    try {
      await api.put('/settings', { dry_run_mode: val });
      toast.success(val ? 'Dry run mode enabled' : 'Dry run mode disabled');
    } catch (err) {
      toast.error('Failed to save setting', { description: err.message });
      setDryRun(!val);
    }
  };

  const d365OrgUrl = settings?.d365_org_url || process.env.REACT_APP_D365_ORG_URL || '';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Settings className="w-6 h-6 text-[#FF4500]" />
        <div>
          <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5]">Connections</h1>
          <p className="text-[#9CA3AF] text-sm">Manage your Microsoft 365 and Dynamics 365 integrations.</p>
        </div>
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
        className="space-y-4"
      >
        {/* M365 / Auth card */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-1">
                Microsoft 365
              </h2>
              <p className="text-[#9CA3AF] text-sm">
                Identity, Outlook, and Dynamics 365 access via Microsoft Entra ID.
              </p>
            </div>
            <StatusPill connected={!!user} />
          </div>
          {user && (
            <div className="bg-[#0f0f10] border border-[#1f2022] px-4 py-3 text-sm">
              <div className="flex gap-8">
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

        {/* D365 card */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-1">
                Dynamics 365
              </h2>
              <p className="text-[#9CA3AF] text-sm">
                Direct Dataverse Web API — creates phone calls, tasks, emails, and meetings.
              </p>
            </div>
            {d365Status !== null && <StatusPill connected={d365Status.connected} />}
          </div>

          {/* Org URL */}
          <div className="bg-[#0f0f10] border border-[#1f2022] px-4 py-3 mb-4">
            <p className="text-[#9CA3AF] text-xs mb-0.5">Organization URL</p>
            <p className="text-[#F2F3F5] text-sm font-mono break-all">
              {d365OrgUrl || 'Not configured'}
            </p>
          </div>

          {/* Dry run toggle */}
          <div className="flex items-center justify-between mb-5 py-3 border-t border-[#1f2022]">
            <div>
              <Label className="text-[#F2F3F5] text-sm font-medium">Dry Run Mode</Label>
              <p className="text-[#9CA3AF] text-xs mt-0.5">
                Test connections without writing real records to D365.
              </p>
            </div>
            <Switch
              data-testid="toggle-dry-run"
              checked={dryRun}
              onCheckedChange={saveDryRun}
              className="data-[state=checked]:bg-[#FF4500]"
            />
          </div>

          {/* Test connection */}
          <Button
            data-testid="btn-test-d365"
            onClick={testD365}
            disabled={testing}
            className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-9 px-5 text-sm transition-colors disabled:opacity-60"
          >
            {testing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing…</>
            ) : (
              <><PlugZap className="w-4 h-4 mr-2" /> Test Connection</>
            )}
          </Button>

          {d365Status && !d365Status.connected && d365Status.error_message && (
            <p className="mt-3 text-xs text-[#ef4444]">{d365Status.error_message}</p>
          )}
        </motion.div>

        {/* Power Automate Webhook card */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-1">
                Power Automate Webhook
              </h2>
              <p className="text-[#9CA3AF] text-sm">
                Bypasses Lenovo tenant OAuth consent. Colleague creates an internal HTTP trigger flow — our app POSTs to it and the flow creates D365 records.
              </p>
            </div>
            {webhookStatus !== null && <StatusPill connected={webhookStatus.configured} />}
          </div>

          {webhookStatus?.configured && (
            <div className="bg-[#0f0f10] border border-[#1f2022] px-4 py-3 mb-4">
              <p className="text-[#9CA3AF] text-xs mb-0.5">Current webhook</p>
              <p className="text-[#F2F3F5] text-sm font-mono break-all">{webhookStatus.url_preview}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://prod-xx.westus.logic.azure.com/workflows/…"
              className="flex-1 bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm placeholder:text-[#9CA3AF]/50 focus-visible:ring-0 focus-visible:border-[#FF4500]"
            />
            <Button
              onClick={saveWebhook}
              disabled={savingWebhook || !webhookUrl}
              className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-9 px-4 text-sm transition-colors disabled:opacity-60 shrink-0"
            >
              {savingWebhook
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <><Save className="w-4 h-4 mr-1.5" /> Save</>}
            </Button>
            {webhookStatus?.configured && (
              <Button
                onClick={clearWebhook}
                disabled={savingWebhook}
                className="bg-transparent hover:bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/30 rounded-none h-9 px-3 text-sm transition-colors disabled:opacity-60 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>

          <p className="text-[#9CA3AF] text-xs mt-3">
            In Power Automate: create a flow with <span className="text-[#F2F3F5]">When an HTTP request is received</span> trigger. The app sends activity_type, subject, account, duration_minutes, and notes as JSON.
          </p>
        </motion.div>

        {/* Browser Cookie Session card */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-1">
                Browser Cookie Session
              </h2>
              <p className="text-[#9CA3AF] text-sm">
                Fallback path. Colleague exports their D365 browser cookies — the server injects them into a headless browser and extracts a valid Bearer token.
              </p>
            </div>
            {cookiesStatus !== null && <StatusPill connected={cookiesStatus.configured} />}
          </div>

          {cookiesStatus?.configured && cookiesStatus.last_saved && (
            <div className="bg-[#0f0f10] border border-[#1f2022] px-4 py-3 mb-4">
              <p className="text-[#9CA3AF] text-xs mb-0.5">Last saved</p>
              <p className="text-[#F2F3F5] text-sm">
                {new Date(cookiesStatus.last_saved).toLocaleString()}
              </p>
            </div>
          )}

          <Textarea
            value={cookiesText}
            onChange={(e) => setCookiesText(e.target.value)}
            placeholder={'Paste cookies JSON here (from Cookie-Editor Chrome extension → Export → Copy)…\n[\n  { "name": "...", "value": "...", "domain": ".dynamics.com", ... }\n]'}
            rows={5}
            className="w-full bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none text-sm font-mono placeholder:text-[#9CA3AF]/40 focus-visible:ring-0 focus-visible:border-[#FF4500] resize-none mb-3"
          />

          <div className="flex items-center justify-between">
            <Button
              onClick={saveCookies}
              disabled={savingCookies || !cookiesText.trim()}
              className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-9 px-5 text-sm transition-colors disabled:opacity-60"
            >
              {savingCookies
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                : <><Globe className="w-4 h-4 mr-2" /> Save Cookies</>}
            </Button>
            <p className="text-[#9CA3AF] text-xs">Stored encrypted. Requires Playwright on server.</p>
          </div>
        </motion.div>

        {/* N8N card — Phase 2 placeholder */}
        <motion.div variants={CARD_VARIANTS} className="bg-[#141416] border border-[#1f2022] p-6 opacity-60">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-1">
                N8N Automation
              </h2>
              <p className="text-[#9CA3AF] text-sm">
                Heartbeat sync and advanced workflow automation. Available in Phase 2.
              </p>
            </div>
            <Badge className="bg-[#1f2022] text-[#9CA3AF] border-[#1f2022] rounded-none text-xs">
              Phase 2
            </Badge>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
