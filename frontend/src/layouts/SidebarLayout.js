import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart2,
  LayoutDashboard,
  MessageSquare,
  ActivitySquare,
  Mic,
  Settings,
  Users,
  Monitor,
  FolderOpen,
  LogOut,
} from 'lucide-react';
import api from '@/lib/api';

const NAV_ITEMS = [
  { to: '/dashboard',          label: 'Dashboard',   icon: LayoutDashboard },
  { to: '/chat',               label: 'AI Agent',    icon: MessageSquare },
  { to: '/activities',         label: 'Activities',  icon: ActivitySquare },
  { to: '/voice-agent',        label: 'Voice Agent', icon: Mic, badge: 'Soon' },
];

const ADMIN_ITEMS = [
  { to: '/admin/connections',    label: 'Connections', icon: Settings },
  { to: '/admin/team',           label: 'Team',        icon: Users },
  { to: '/admin/monitoring',     label: 'Monitoring',  icon: Monitor },
  { to: '/admin/file-management', label: 'Files',      icon: FolderOpen },
];

export default function SidebarLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    api.get('/auth/me').then(setUser).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await api.post('/auth/logout').catch(() => {});
    navigate('/login', { replace: true });
  };

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div className="min-h-screen bg-[#0f0f10] text-[#F2F3F5] flex">
      {/* ── Sidebar ── */}
      <aside className="w-40 shrink-0 border-r border-[#1f2022] flex flex-col bg-[#0f0f10]">
        {/* Logo */}
        <div className="h-14 flex items-center gap-2 px-4 border-b border-[#1f2022]">
          <div className="w-6 h-6 bg-[#FF4500] flex items-center justify-center shrink-0">
            <BarChart2 className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-['Space_Grotesk'] text-sm font-bold text-[#F2F3F5] truncate">
            Sales Copilot
          </span>
        </div>

        {/* Primary nav */}
        <nav className="flex flex-col pt-3 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex items-center gap-2.5 px-4 h-9 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-[#FF4500] bg-[#FF4500]/8'
                    : 'text-[#9CA3AF] hover:text-[#F2F3F5] hover:bg-[#1f2022]/60'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#FF4500]" />
                  )}
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{label}</span>
                  {badge && (
                    <span className="ml-auto px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold border border-[#1f2022] bg-[#1f2022]/60 text-[#9CA3AF] shrink-0">
                      {badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}

          {/* Admin section */}
          {user?.role === 'admin' && (
            <>
              <div className="mx-4 my-2 border-t border-[#1f2022]" />
              <p className="px-4 pb-1 text-[10px] uppercase tracking-widest text-[#9CA3AF]/60 font-medium">
                Admin
              </p>
              {ADMIN_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `relative flex items-center gap-2.5 px-4 h-9 text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-[#FF4500] bg-[#FF4500]/8'
                        : 'text-[#9CA3AF] hover:text-[#F2F3F5] hover:bg-[#1f2022]/60'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#FF4500]" />
                      )}
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="border-t border-[#1f2022] p-3">
          <button
            onClick={() => navigate('/profile')}
            className="flex items-center gap-2 mb-2 w-full hover:opacity-75 transition-opacity"
            title="Account & Settings"
          >
            <div className="w-6 h-6 bg-[#FF4500]/20 border border-[#FF4500]/30 flex items-center justify-center text-[#FF4500] text-[10px] font-bold shrink-0">
              {initials}
            </div>
            <div className="min-w-0 text-left">
              <p className="text-xs font-medium text-[#F2F3F5] truncate">{user?.name || ''}</p>
              <p className="text-[10px] text-[#9CA3AF] truncate">{user?.role || ''}</p>
            </div>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-[#9CA3AF] hover:text-[#ef4444] transition-colors w-full"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Page content ── */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
