import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart2, ClipboardList, MessageSquare, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const FEATURES = [
  {
    icon: ClipboardList,
    title: 'Activity logging',
    desc: 'Auto-create D365 phone calls, tasks, and appointments in seconds.',
  },
  {
    icon: Zap,
    title: 'Bulk automation',
    desc: 'Run activity rules across hundreds of accounts at once via Power Automate.',
  },
  {
    icon: MessageSquare,
    title: 'AI chat workflows',
    desc: 'Trigger D365 actions and get live app context through conversational AI.',
  },
];

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const [devEnabled, setDevEnabled]   = useState(false);
  const [devUser, setDevUser]         = useState('');
  const [devPass, setDevPass]         = useState('');
  const [devLoading, setDevLoading]   = useState(false);
  const [devError, setDevError]       = useState('');

  useEffect(() => {
    fetch('/api/auth/dev-login/check')
      .then(r => r.json())
      .then(d => setDevEnabled(d?.data?.enabled === true))
      .catch(() => {});
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || 'Invalid credentials');
        return;
      }
      window.location.href = '/#/dashboard';
    } catch {
      setError('Connection error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setDevLoading(true);
    setDevError('');
    try {
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: devUser, password: devPass }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDevError(err.detail || 'Invalid credentials');
        return;
      }
      window.location.href = '/#/dashboard';
    } catch {
      setDevError('Connection error. Is the backend running?');
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#0f0f10] text-[#F2F3F5]">
      {/* ── Left panel (60%) ── */}
      <div className="hidden lg:flex lg:w-[60%] flex-col justify-center px-12 xl:px-24 border-r border-[#1f2022]">
        <div className="max-w-2xl">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="font-['Space_Grotesk'] text-5xl xl:text-6xl font-bold leading-tight mb-6"
          >
            Your sales workflows,{' '}
            <br />
            <span className="text-[#FF4500]">on autopilot.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-[#9CA3AF] text-lg xl:text-xl leading-relaxed mb-12"
          >
            Connect your D365 org and let AI handle activity logging,
            bulk automation, and lead discovery.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.08 } },
            }}
            className="space-y-8"
          >
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <motion.div
                key={title}
                variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
                className="flex items-start gap-5"
              >
                <div className="flex items-center justify-center w-12 h-12 shrink-0 bg-[#FF4500]/10 border border-[#FF4500]/20 text-[#FF4500]">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-['Space_Grotesk'] text-[#F2F3F5] text-lg font-bold mb-1">
                    {title}
                  </h3>
                  <p className="text-[#9CA3AF] text-sm">{desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* ── Right panel (40%) ── */}
      <div className="w-full lg:w-[40%] flex flex-col items-center justify-center px-6 sm:px-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.15 }}
          className="w-full max-w-md p-10 bg-[#141416] border border-[#1f2022] shadow-2xl"
        >
          {/* Logo + app name */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-[#FF4500] flex items-center justify-center shrink-0">
              <BarChart2 className="w-5 h-5 text-white" />
            </div>
            <span className="font-['Space_Grotesk'] text-[#F2F3F5] text-2xl font-bold tracking-tight">
              Sales Copilot
            </span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h3 className="font-['Space_Grotesk'] text-[#F2F3F5] text-xl font-bold mb-2">
              Sign in to continue
            </h3>
            <p className="text-[#9CA3AF] text-sm">
              Enter your credentials to access your workspace.
            </p>
          </div>

          {/* Email + Password form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Email</Label>
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-10 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-10 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
              />
            </div>

            {error && (
              <p className="text-[#ef4444] text-xs">{error}</p>
            )}

            <Button
              type="submit"
              data-testid="login-button"
              disabled={loading || !email || !password}
              className="w-full h-11 bg-[#FF4500] hover:bg-[#e63e00] text-white font-medium transition-colors rounded-none disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {/* Footer note */}
          <p className="text-[#9CA3AF] text-xs mt-6">
            Contact your admin to be added to the team.
          </p>

          {/* Dev / Demo override — only renders when DEV_LOGIN_ENABLED=true */}
          {devEnabled && (
            <>
              <div style={{ borderTop: '1px solid #1f2022', margin: '24px 0' }} />
              <p className="text-[#9CA3AF] text-xs mb-3">Admin Override</p>
              <Input
                placeholder="Username"
                value={devUser}
                onChange={e => setDevUser(e.target.value)}
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none"
              />
              <Input
                type="password"
                placeholder="Password"
                value={devPass}
                onChange={e => setDevPass(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleDevLogin()}
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none mt-2"
              />
              {devError && (
                <p className="text-[#ef4444] text-xs mt-2">{devError}</p>
              )}
              <Button
                onClick={handleDevLogin}
                disabled={devLoading || !devUser || !devPass}
                className="w-full h-10 mt-3 bg-[#1f2022] hover:bg-[#2a2c2e] text-[#F2F3F5] font-medium transition-colors rounded-none"
              >
                {devLoading ? 'Signing in...' : 'Continue'}
              </Button>
            </>
          )}
        </motion.div>

        {/* Mobile headline — only below lg */}
        <div className="lg:hidden mt-10 px-4">
          <h1 className="font-['Space_Grotesk'] text-[#F2F3F5] text-3xl font-bold leading-tight mb-3">
            Your sales workflows, <span className="text-[#FF4500]">on autopilot.</span>
          </h1>
          <p className="text-[#9CA3AF] text-sm">
            Connect your D365 org and let AI handle activity logging.
          </p>
        </div>
      </div>
    </div>
  );
}
