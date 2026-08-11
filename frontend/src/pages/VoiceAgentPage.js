import { Mic, Sparkles, Waypoints, ShieldCheck } from 'lucide-react';

const UPCOMING = [
  {
    icon: Mic,
    title: 'Live call transcription (STT)',
    desc: 'Sales-client calls streamed through speech-to-text in real time, with speaker separation.',
  },
  {
    icon: Sparkles,
    title: 'Structured PRD + onboarding extraction',
    desc: 'Raw transcripts distilled into a structured requirements doc the moment the call ends — no manual note-taking.',
  },
  {
    icon: Waypoints,
    title: 'Auto account resolution',
    desc: 'Any account mentioned mid-call is matched against the account repository by unique ID and linked automatically.',
  },
  {
    icon: ShieldCheck,
    title: 'Direct D365 logging',
    desc: 'Resolved activity flows straight into D365 — reps never touch a keyboard after the call.',
  },
];

export default function VoiceAgentPage() {
  return (
    <div className="min-h-screen bg-[#0f0f10] text-[#F2F3F5] p-6 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Voice Agent</h1>
          <span className="px-2 py-0.5 text-[10px] uppercase tracking-widest font-medium border border-[#FF4500]/40 bg-[#FF4500]/8 text-[#FF4500]">
            In refinement — V3
          </span>
        </div>
        <p className="text-[#9CA3AF] text-sm mb-8">
          The voice pipeline below is being hardened for general rollout. Target: September 15, 2026.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          {UPCOMING.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-[#141416] border border-[#1f2022] p-5">
              <Icon className="w-4 h-4 text-[#FF4500] mb-3" />
              <h2 className="text-sm font-semibold text-[#F2F3F5] mb-1">{title}</h2>
              <p className="text-[#9CA3AF] text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
