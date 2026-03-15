import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BarChart2, LayoutDashboard, MessageSquare, Bell, ChevronDown, LogOut, Users, Settings, Monitor } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import api from '@/lib/api';

const NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/chat',      label: 'AI Chat',   icon: MessageSquare },
];

export default function TopNavLayout() {
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
    <div className="min-h-screen bg-[#0f0f10] text-[#F2F3F5] flex flex-col">
      {/* ── Top nav bar ── */}
      <header className="h-14 border-b border-[#1f2022] flex items-center px-6 shrink-0 bg-[#0f0f10] z-20">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mr-10">
          <div className="w-7 h-7 bg-[#FF4500] flex items-center justify-center shrink-0">
            <BarChart2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-['Space_Grotesk'] text-[#F2F3F5] text-base font-bold tracking-tight">
            Sales Copilot
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={`nav-${label.toLowerCase().replace(' ', '-')}`}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 h-8 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-[#FF4500] bg-[#FF4500]/10'
                    : 'text-[#9CA3AF] hover:text-[#F2F3F5] hover:bg-[#1f2022]'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          <button
            data-testid="nav-bell"
            className="w-8 h-8 flex items-center justify-center text-[#9CA3AF] hover:text-[#F2F3F5] transition-colors"
          >
            <Bell className="w-4 h-4" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="nav-avatar-menu"
              className="flex items-center gap-2 text-sm text-[#9CA3AF] hover:text-[#F2F3F5] transition-colors focus:outline-none"
            >
              <div className="w-7 h-7 bg-[#FF4500]/20 border border-[#FF4500]/30 flex items-center justify-center text-[#FF4500] text-xs font-bold shrink-0">
                {initials}
              </div>
              <span className="hidden sm:block text-[#F2F3F5] text-sm font-medium max-w-[120px] truncate">
                {user?.name || ''}
              </span>
              <ChevronDown className="w-3.5 h-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 bg-[#141416] border-[#1f2022] text-[#F2F3F5]"
            >
              {user?.role === 'admin' && (
                <>
                  <DropdownMenuItem
                    data-testid="nav-team"
                    onClick={() => navigate('/admin/team')}
                    className="cursor-pointer hover:bg-[#1f2022] focus:bg-[#1f2022]"
                  >
                    <Users className="w-4 h-4 mr-2" /> Team
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="nav-connections"
                    onClick={() => navigate('/admin/connections')}
                    className="cursor-pointer hover:bg-[#1f2022] focus:bg-[#1f2022]"
                  >
                    <Settings className="w-4 h-4 mr-2" /> Connections
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="nav-monitoring"
                    onClick={() => navigate('/admin/monitoring')}
                    className="cursor-pointer hover:bg-[#1f2022] focus:bg-[#1f2022]"
                  >
                    <Monitor className="w-4 h-4 mr-2" /> Monitoring
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-[#1f2022]" />
                </>
              )}
              <DropdownMenuItem
                data-testid="nav-logout"
                onClick={handleLogout}
                className="cursor-pointer text-[#ef4444] hover:bg-[#1f2022] focus:bg-[#1f2022]"
              >
                <LogOut className="w-4 h-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ── Page content ── */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
