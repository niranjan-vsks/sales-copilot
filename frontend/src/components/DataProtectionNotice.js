import { useState, useEffect } from 'react';
import { Shield, X } from 'lucide-react';

const STORAGE_KEY = 'dp_acknowledged';

export default function DataProtectionNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4">
      <div className="bg-[#141416] border border-[#1f2022] px-4 py-3 flex items-start gap-3 shadow-xl">
        <Shield className="w-4 h-4 text-[#FF4500] shrink-0 mt-0.5" />
        <p className="text-[#9CA3AF] text-xs leading-relaxed flex-1">
          Your data is safe and securely protected. We do not share your information with third parties.{' '}
          <span className="text-[#F2F3F5]">Your data, your control.</span>
        </p>
        <button onClick={dismiss} className="text-[#9CA3AF] hover:text-[#F2F3F5] transition-colors shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
