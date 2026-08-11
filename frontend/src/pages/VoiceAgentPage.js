import { Mic } from 'lucide-react';

export default function VoiceAgentPage() {
  return (
    <div className="min-h-screen bg-[#0f0f10] text-[#F2F3F5] flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-[#141416] border border-[#1f2022] p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center bg-[#FF4500]/10 border border-[#FF4500]/20 text-[#FF4500]">
          <Mic className="w-5 h-5" />
        </div>
        <h1 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-1.5">
          Voice Agent
        </h1>
        <p className="text-[#9CA3AF] text-sm leading-relaxed mb-4">
          Call-to-CRM logging, powered by voice. Rolling out to accounts soon.
        </p>
        <span className="inline-block px-2.5 py-1 text-[10px] uppercase tracking-widest font-medium border border-[#1f2022] bg-[#0f0f10] text-[#9CA3AF]">
          Coming Soon
        </span>
      </div>
    </div>
  );
}
