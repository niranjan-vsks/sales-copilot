import React from 'react';
import { motion } from 'framer-motion';
import { BarChart2, Mail, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MS_ICON = (
  <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M1 1H10V10H1V1Z" fill="#F25022" />
    <path d="M11 1H20V10H11V1Z" fill="#7FBA00" />
    <path d="M1 11H10V20H1V11Z" fill="#00A4EF" />
    <path d="M11 11H20V20H11V11Z" fill="#FFB900" />
  </svg>
);

const FEATURES = [
  {
    icon: BarChart2,
    title: 'Activity logging',
    desc: 'Automated D365 logging for every interaction.',
  },
  {
    icon: Mail,
    title: 'Email automation',
    desc: 'Smart email chains that nurture leads effectively.',
  },
  {
    icon: MessageSquare,
    title: 'AI chat routing',
    desc: 'Intelligent lead discovery via conversational AI.',
  },
];

export default function LoginPage() {
  const handleLogin = () => {
    window.location.href = '/api/auth/microsoft';
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
            Connect Microsoft 365 and let AI handle your D365 logging,
            email chains, and lead discovery.
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
              Welcome back — authenticate with your corporate Microsoft account.
            </p>
          </div>

          {/* Microsoft sign-in button */}
          <Button
            onClick={handleLogin}
            data-testid="microsoft-signin-button"
            className="w-full h-12 flex items-center justify-center gap-3 bg-[#0078D4] hover:bg-[#0067b8] text-white font-medium transition-colors mb-6 rounded-none"
          >
            {MS_ICON}
            Sign in with Microsoft
          </Button>

          {/* Footer note */}
          <p className="text-[#9CA3AF] text-xs">
            Access requires a Cisco Microsoft 365 account. Contact your admin to be added to the team.
          </p>
        </motion.div>

        {/* Mobile headline — only below lg */}
        <div className="lg:hidden mt-10 px-4">
          <h1 className="font-['Space_Grotesk'] text-[#F2F3F5] text-3xl font-bold leading-tight mb-3">
            Your sales workflows, <span className="text-[#FF4500]">on autopilot.</span>
          </h1>
          <p className="text-[#9CA3AF] text-sm">
            Connect Microsoft 365 and let AI handle your D365 logging.
          </p>
        </div>
      </div>
    </div>
  );
}
