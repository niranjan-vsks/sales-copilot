import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings, Users, Monitor, FolderOpen, LogOut,
  LayoutDashboard, MessageSquare, ActivitySquare,
  ChevronRight, Save, Eye, EyeOff, Loader2,
  Bell, UserCog, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import api from '@/lib/api';

const ADMIN_LINKS = [
  { label: 'Connections',    icon: Settings,       to: '/admin/connections',    desc: 'Webhook and CRM configuration' },
  { label: 'Team Members',   icon: Users,           to: '/admin/team',           desc: 'Add, remove, and manage user roles' },
  { label: 'Monitoring',     icon: Monitor,         to: '/admin/monitoring',     desc: 'Execution stats and recent job history' },
  { label: 'File Management',icon: FolderOpen,      to: '/admin/file-management',desc: 'Upload account data and manage files' },
];

const NAV_LINKS = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard', desc: 'Workflow overview and quick actions' },
  { label: 'AI Agent',  icon: MessageSquare,   to: '/chat',      desc: 'Chat with your sales AI agent' },
  { label: 'Activities',icon: ActivitySquare,  to: '/activities',desc: 'View logged activity records' },
];

const TIMEZONES = [
  'UTC', 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles',
  'America/Chicago', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo',
  'Asia/Singapore', 'Australia/Sydney',
];

function SectionHeader({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2 mb-3 px-1">
      <Icon className="w-3.5 h-3.5 text-[#FF4500]" />
      <p className="text-[10px] uppercase tracking-widest text-[#9CA3AF]/70 font-medium">{title}</p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-3.5 px-4 border-b border-[#1f2022] last:border-0">
      <label className="text-xs text-[#9CA3AF] font-medium w-40 shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function LinkRow({ icon: Icon, label, desc, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-3.5 transition-colors text-left ${
        danger ? 'hover:bg-[#ef4444]/5' : 'hover:bg-[#1f2022]/60'
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${danger ? 'text-[#ef4444]' : 'text-[#9CA3AF]'}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${danger ? 'text-[#ef4444]' : 'text-[#F2F3F5]'}`}>{label}</p>
        <p className="text-xs text-[#9CA3AF]">{desc}</p>
      </div>
      {!danger && <ChevronRight className="w-4 h-4 text-[#9CA3AF]/40 shrink-0" />}
    </button>
  );
}

export default function UserProfilePage() {
  const navigate = useNavigate();
  const [user, setUser]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [activityTypes, setActivityTypes] = useState([]);

  // Account form state
  const [name, setName]           = useState('');
  const [savingName, setSavingName] = useState(false);

  // Password form state
  const [curPwd, setCurPwd]       = useState('');
  const [newPwd, setNewPwd]       = useState('');
  const [showCur, setShowCur]     = useState(false);
  const [showNew, setShowNew]     = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  // Preferences state
  const [prefs, setPrefs]         = useState({
    default_activity_type: '',
    default_duration_minutes: '',
    timezone: 'UTC',
  });
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Notifications state
  const [notif, setNotif]         = useState({
    notify_email: false,
    notify_email_address: '',
    notify_telegram: false,
    telegram_bot_token: '',
    telegram_chat_id: '',
  });
  const [savingNotif, setSavingNotif] = useState(false);

  const loadAll = useCallback(() => {
    Promise.all([
      api.get('/auth/me'),
      api.get('/user/preferences').catch(() => null),
      api.get('/config/activity-types').catch(() => []),
    ]).then(([u, p, types]) => {
      setUser(u);
      setName(u.name || '');
      if (p) {
        setPrefs({
          default_activity_type:  p.default_activity_type  || '',
          default_duration_minutes: p.default_duration_minutes != null ? String(p.default_duration_minutes) : '',
          timezone: p.timezone || 'UTC',
        });
        setNotif({
          notify_email:         !!p.notify_email,
          notify_email_address: p.notify_email_address  || '',
          notify_telegram:      !!p.notify_telegram,
          telegram_bot_token:   p.telegram_bot_token    || '',
          telegram_chat_id:     p.telegram_chat_id      || '',
        });
      }
      setActivityTypes(Array.isArray(types) ? types : []);
    })
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setLoading(false));
  }, [navigate]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleLogout = async () => {
    await api.post('/auth/logout').catch(() => {});
    navigate('/login', { replace: true });
  };

  const saveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    try {
      await api.patch('/auth/me', { name: name.trim() });
      setUser((u) => ({ ...u, name: name.trim() }));
      toast.success('Name updated');
    } catch (e) {
      toast.error('Failed to update name', { description: e.message });
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async () => {
    if (!curPwd || !newPwd) return;
    if (newPwd.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    setSavingPwd(true);
    try {
      await api.post('/auth/change-password', { current_password: curPwd, new_password: newPwd });
      setCurPwd(''); setNewPwd('');
      toast.success('Password changed');
    } catch (e) {
      toast.error('Failed to change password', { description: e.message });
    } finally {
      setSavingPwd(false);
    }
  };

  const savePrefs = async () => {
    setSavingPrefs(true);
    try {
      await api.patch('/user/preferences', {
        default_activity_type: prefs.default_activity_type || null,
        default_duration_minutes: prefs.default_duration_minutes ? parseInt(prefs.default_duration_minutes) : null,
        timezone: prefs.timezone || null,
      });
      toast.success('Preferences saved');
    } catch (e) {
      toast.error('Failed to save preferences', { description: e.message });
    } finally {
      setSavingPrefs(false);
    }
  };

  const saveNotif = async () => {
    setSavingNotif(true);
    try {
      await api.patch('/user/preferences', {
        notify_email:         notif.notify_email,
        notify_email_address: notif.notify_email_address || null,
        notify_telegram:      notif.notify_telegram,
        telegram_bot_token:   notif.telegram_bot_token   || null,
        telegram_chat_id:     notif.telegram_chat_id     || null,
      });
      toast.success('Notification settings saved');
    } catch (e) {
      toast.error('Failed to save notifications', { description: e.message });
    } finally {
      setSavingNotif(false);
    }
  };

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const isMsAuth = !!user?.ms_user_id;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f10] flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-[#FF4500] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f10] text-[#F2F3F5] p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-bold font-['Space_Grotesk'] text-[#F2F3F5]">Account</h1>
        <p className="text-sm text-[#9CA3AF] mt-0.5">Profile and application settings</p>
      </div>

      {/* Profile card */}
      <div className="border border-[#1f2022] bg-[#111213] p-5 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-[#FF4500]/20 border-2 border-[#FF4500]/40 flex items-center justify-center text-[#FF4500] text-lg font-bold shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-[#F2F3F5] truncate">{user?.name}</p>
            <p className="text-sm text-[#9CA3AF] truncate">{user?.email}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                user?.role === 'admin'
                  ? 'bg-[#FF4500]/15 text-[#FF4500] border border-[#FF4500]/30'
                  : 'bg-[#9CA3AF]/10 text-[#9CA3AF] border border-[#9CA3AF]/20'
              }`}>
                {user?.role}
              </span>
              {isMsAuth && (
                <span className="inline-block px-2 py-0.5 text-[10px] font-medium bg-[#0078d4]/15 text-[#60a5fa] border border-[#60a5fa]/20 uppercase tracking-wider">
                  Microsoft
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Account Settings ───────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionHeader icon={UserCog} title="Account Settings" />
        <div className="border border-[#1f2022] bg-[#111213]">
          <Field label="Display name">
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="flex-1 bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/50 rounded-none h-8 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
              />
              <Button
                onClick={saveName}
                disabled={savingName || !name.trim() || name.trim() === user?.name}
                size="sm"
                className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 px-3 text-xs disabled:opacity-50"
              >
                {savingName ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              </Button>
            </div>
          </Field>

          <Field label="Email">
            <p className="text-sm text-[#F2F3F5]">{user?.email}</p>
          </Field>

          {!isMsAuth && (
            <>
              <Field label="Current password">
                <div className="relative">
                  <Input
                    type={showCur ? 'text' : 'password'}
                    value={curPwd}
                    onChange={(e) => setCurPwd(e.target.value)}
                    placeholder="Current password"
                    className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/50 rounded-none h-8 text-sm pr-9 focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCur(!showCur)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#F2F3F5]"
                  >
                    {showCur ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </Field>
              <Field label="New password">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showNew ? 'text' : 'password'}
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                      placeholder="Min 8 characters"
                      className="w-full bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/50 rounded-none h-8 text-sm pr-9 focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(!showNew)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#F2F3F5]"
                    >
                      {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <Button
                    onClick={savePassword}
                    disabled={savingPwd || !curPwd || !newPwd}
                    size="sm"
                    className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 px-3 text-xs disabled:opacity-50"
                  >
                    {savingPwd ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Change'}
                  </Button>
                </div>
              </Field>
            </>
          )}

          {isMsAuth && (
            <div className="px-4 py-3 text-xs text-[#9CA3AF]">
              Password changes are managed through your Microsoft account.
            </div>
          )}
        </div>
      </div>

      {/* ── Preferences ───────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionHeader icon={Settings} title="Preferences" />
        <div className="border border-[#1f2022] bg-[#111213]">
          <Field label="Default activity type">
            <Select
              value={prefs.default_activity_type || '__none__'}
              onValueChange={(v) => setPrefs((p) => ({ ...p, default_activity_type: v === '__none__' ? '' : v }))}
            >
              <SelectTrigger className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-8 text-sm focus:ring-[#FF4500]">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                <SelectItem value="__none__" className="focus:bg-[#1f2022]">None</SelectItem>
                {activityTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="focus:bg-[#1f2022]">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Default duration (min)">
            <Input
              type="number"
              min="1"
              value={prefs.default_duration_minutes}
              onChange={(e) => setPrefs((p) => ({ ...p, default_duration_minutes: e.target.value }))}
              placeholder="e.g. 30"
              className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/50 rounded-none h-8 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
            />
          </Field>

          <Field label="Timezone">
            <Select
              value={prefs.timezone}
              onValueChange={(v) => setPrefs((p) => ({ ...p, timezone: v }))}
            >
              <SelectTrigger className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-8 text-sm focus:ring-[#FF4500]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz} className="focus:bg-[#1f2022]">{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="px-4 py-3 flex justify-end border-t border-[#1f2022]">
            <Button
              onClick={savePrefs}
              disabled={savingPrefs}
              size="sm"
              className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 px-4 text-xs disabled:opacity-50"
            >
              {savingPrefs ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
              Save preferences
            </Button>
          </div>
        </div>
      </div>

      {/* ── Notifications ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <SectionHeader icon={Bell} title="Notifications" />
        <div className="border border-[#1f2022] bg-[#111213]">
          {/* Email */}
          <div className="px-4 py-3.5 border-b border-[#1f2022]">
            <label className="flex items-center gap-3 cursor-pointer mb-2">
              <div
                onClick={() => setNotif((n) => ({ ...n, notify_email: !n.notify_email }))}
                className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                  notif.notify_email ? 'bg-[#FF4500]' : 'bg-[#1f2022]'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  notif.notify_email ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </div>
              <span className="text-sm text-[#F2F3F5] font-medium">Email notifications</span>
            </label>
            {notif.notify_email && (
              <Input
                type="email"
                value={notif.notify_email_address}
                onChange={(e) => setNotif((n) => ({ ...n, notify_email_address: e.target.value }))}
                placeholder="Notification email address"
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/50 rounded-none h-8 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500] mt-2"
              />
            )}
          </div>

          {/* Telegram */}
          <div className="px-4 py-3.5 border-b border-[#1f2022]">
            <label className="flex items-center gap-3 cursor-pointer mb-2">
              <div
                onClick={() => setNotif((n) => ({ ...n, notify_telegram: !n.notify_telegram }))}
                className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                  notif.notify_telegram ? 'bg-[#FF4500]' : 'bg-[#1f2022]'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  notif.notify_telegram ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </div>
              <div className="flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-[#9CA3AF]" />
                <span className="text-sm text-[#F2F3F5] font-medium">Telegram Agent alerts</span>
              </div>
            </label>
            {notif.notify_telegram && (
              <div className="space-y-2 mt-2">
                <Input
                  value={notif.telegram_bot_token}
                  onChange={(e) => setNotif((n) => ({ ...n, telegram_bot_token: e.target.value }))}
                  placeholder="Bot token (from @BotFather)"
                  className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/50 rounded-none h-8 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
                />
                <Input
                  value={notif.telegram_chat_id}
                  onChange={(e) => setNotif((n) => ({ ...n, telegram_chat_id: e.target.value }))}
                  placeholder="Chat ID (from @userinfobot)"
                  className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/50 rounded-none h-8 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
                />
              </div>
            )}
          </div>

          <div className="px-4 py-3 flex justify-end">
            <Button
              onClick={saveNotif}
              disabled={savingNotif}
              size="sm"
              className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 px-4 text-xs disabled:opacity-50"
            >
              {savingNotif ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
              Save notifications
            </Button>
          </div>
        </div>
      </div>

      {/* Admin settings */}
      {user?.role === 'admin' && (
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-widest text-[#9CA3AF]/60 font-medium mb-2 px-1">
            Admin Settings
          </p>
          <div className="border border-[#1f2022] bg-[#111213] divide-y divide-[#1f2022]">
            {ADMIN_LINKS.map(({ label, icon, to, desc }) => (
              <LinkRow key={to} icon={icon} label={label} desc={desc} onClick={() => navigate(to)} />
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-widest text-[#9CA3AF]/60 font-medium mb-2 px-1">
          Navigation
        </p>
        <div className="border border-[#1f2022] bg-[#111213] divide-y divide-[#1f2022]">
          {NAV_LINKS.map(({ label, icon, to, desc }) => (
            <LinkRow key={to} icon={icon} label={label} desc={desc} onClick={() => navigate(to)} />
          ))}
        </div>
      </div>

      {/* Sign out */}
      <div className="border border-[#1f2022] bg-[#111213]">
        <LinkRow icon={LogOut} label="Sign out" desc="End your current session" onClick={handleLogout} danger />
      </div>
    </div>
  );
}
