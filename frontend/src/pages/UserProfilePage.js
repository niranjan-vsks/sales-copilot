import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings,
  Users,
  Monitor,
  FolderOpen,
  LogOut,
  LayoutDashboard,
  MessageSquare,
  ActivitySquare,
  ChevronRight,
} from 'lucide-react';
import api from '@/lib/api';

const ADMIN_LINKS = [
  { label: 'Connections', icon: Settings, to: '/admin/connections', desc: 'D365, webhook, and browser session config' },
  { label: 'Team Members', icon: Users, to: '/admin/team', desc: 'Add, remove, and manage user roles' },
  { label: 'Monitoring', icon: Monitor, to: '/admin/monitoring', desc: 'Execution stats and recent job history' },
  { label: 'File Management', icon: FolderOpen, to: '/admin/file-management', desc: 'Upload account data and manage files' },
];

const NAV_LINKS = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard', desc: 'Workflow overview and quick actions' },
  { label: 'AI Chat', icon: MessageSquare, to: '/chat', desc: 'Chat with your sales AI assistant' },
  { label: 'Activities', icon: ActivitySquare, to: '/activities', desc: 'View logged D365 activity records' },
];

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
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/me')
      .then(setUser)
      .catch(() => navigate('/login', { replace: true }))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleLogout = async () => {
    await api.post('/auth/logout').catch(() => {});
    navigate('/login', { replace: true });
  };

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f10] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#FF4500] border-t-transparent rounded-full animate-spin" />
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
      <div className="border border-[#1f2022] bg-[#111213] p-5 mb-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-[#FF4500]/20 border-2 border-[#FF4500]/40 flex items-center justify-center text-[#FF4500] text-lg font-bold shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-[#F2F3F5] truncate">{user?.name}</p>
            <p className="text-sm text-[#9CA3AF] truncate">{user?.email}</p>
            <span className={`inline-block mt-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              user?.role === 'admin'
                ? 'bg-[#FF4500]/15 text-[#FF4500] border border-[#FF4500]/30'
                : 'bg-[#9CA3AF]/10 text-[#9CA3AF] border border-[#9CA3AF]/20'
            }`}>
              {user?.role}
            </span>
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
        <LinkRow
          icon={LogOut}
          label="Sign out"
          desc="End your current session"
          onClick={handleLogout}
          danger
        />
      </div>
    </div>
  );
}
