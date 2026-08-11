import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart2, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { encryptField } from '@/lib/crypto';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
      <rect x="12" y="1" width="10" height="10" fill="#7fba00"/>
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef"/>
      <rect x="12" y="12" width="10" height="10" fill="#ffb900"/>
    </svg>
  );
}

function passwordStrength(pw) {
  const score = [
    pw.length >= 8,
    /[A-Z]/.test(pw),
    /[a-z]/.test(pw),
    /\d/.test(pw),
    /[^A-Za-z0-9]/.test(pw),
  ].filter(Boolean).length;

  if (score <= 1) return { label: 'Weak',        color: '#ef4444', width: '20%' };
  if (score === 2) return { label: 'Fair',        color: '#f97316', width: '40%' };
  if (score === 3) return { label: 'Fair',        color: '#f97316', width: '60%' };
  if (score === 4) return { label: 'Strong',      color: '#22c55e', width: '80%' };
  return             { label: 'Very Strong',  color: '#16a34a', width: '100%' };
}

// ── Step 1: Registration form ────────────────────────────────────────────────

function RegistrationForm({ onSuccess }) {
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [errors,   setErrors]   = useState({});

  const strength = password ? passwordStrength(password) : null;

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = 'Name is required.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = 'Invalid email format.';
    if (password.length < 8) e.password = 'Password must be at least 8 characters.';
    if (password !== confirm) e.confirm = 'Passwords do not match.';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    setErrors({});
    try {
      const encryptedPassword = await encryptField(password);
      await api.post('/auth/signup', { email, password: encryptedPassword, name: name.trim() });
      onSuccess(email);
    } catch (err) {
      const msg = err.message || 'Something went wrong.';
      if (msg.toLowerCase().includes('microsoft')) setErrors({ email: msg });
      else if (msg.toLowerCase().includes('already exists')) setErrors({ email: msg });
      else if (msg.toLowerCase().includes('password')) setErrors({ password: msg });
      else if (msg.toLowerCase().includes('email')) setErrors({ email: msg });
      else setErrors({ form: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Full Name</Label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          required
          className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-10 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
        />
        {errors.name && <p className="text-[#ef4444] text-xs mt-1">{errors.name}</p>}
      </div>

      <div>
        <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Email</Label>
        <Input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-10 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
        />
        {errors.email && <p className="text-[#ef4444] text-xs mt-1">{errors.email}</p>}
      </div>

      <div>
        <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Password</Label>
        <div className="relative">
          <Input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-10 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500] pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPw(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#F2F3F5] transition-colors"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {password && strength && (
          <div className="mt-2">
            <div className="h-1 bg-[#1f2022] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: strength.width, backgroundColor: strength.color }}
              />
            </div>
            <p className="text-xs mt-1" style={{ color: strength.color }}>{strength.label}</p>
          </div>
        )}
        {errors.password && <p className="text-[#ef4444] text-xs mt-1">{errors.password}</p>}
      </div>

      <div>
        <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Confirm Password</Label>
        <Input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="••••••••"
          required
          className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-10 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
        />
        {errors.confirm && <p className="text-[#ef4444] text-xs mt-1">{errors.confirm}</p>}
      </div>

      {errors.form && <p className="text-[#ef4444] text-xs">{errors.form}</p>}

      <Button
        type="submit"
        disabled={loading || !name || !email || !password || !confirm}
        className="w-full h-11 bg-[#FF4500] hover:bg-[#e63e00] text-white font-medium transition-colors rounded-none disabled:opacity-60"
      >
        {loading ? 'Creating account…' : 'Create Account'}
      </Button>

      <div className="relative flex items-center">
        <div className="flex-1 border-t border-[#1f2022]" />
        <span className="px-3 text-[#9CA3AF] text-xs">or</span>
        <div className="flex-1 border-t border-[#1f2022]" />
      </div>

      <a
        href={`${BACKEND_URL}/api/auth/microsoft`}
        className="flex items-center justify-center gap-3 w-full h-11 bg-white text-[#3d3d3d] text-sm font-medium hover:bg-gray-50 border border-[#e0e0e0] transition-colors"
      >
        <MicrosoftIcon />
        Sign in with Microsoft
      </a>

      <p className="text-[#9CA3AF] text-xs text-center">
        Already have an account?{' '}
        <Link to="/login" className="text-[#FF4500] hover:underline">Sign in</Link>
      </p>
    </form>
  );
}

// ── Step 2: OTP verification ─────────────────────────────────────────────────

function OtpVerification({ email, onBack }) {
  const [digits,  setDigits]  = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [shake,   setShake]   = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const refs = useRef([]);

  useEffect(() => { refs.current[0]?.focus(); }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const submitOtp = async (digitArr) => {
    const otp = digitArr.join('');
    if (otp.length < 6) return;
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/verify-email', { email, otp });
      window.location.href = '/#/dashboard';
    } catch (err) {
      setError(err.message || 'Invalid code.');
      triggerShake();
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => refs.current[0]?.focus(), 50);
    } finally {
      setLoading(false);
    }
  };

  const handleDigit = (idx, val) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...digits];
    next[idx] = val;
    setDigits(next);
    if (val && idx < 5) refs.current[idx + 1]?.focus();
    if (val && idx === 5) submitOtp([...next]);
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const next = pasted.split('');
      setDigits(next);
      submitOtp(next);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    try {
      await api.post('/auth/resend-otp', { email });
      setCooldown(60);
      setError('');
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => refs.current[0]?.focus(), 50);
    } catch (err) {
      setError(err.message || 'Failed to resend code.');
    }
  };

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[#9CA3AF] hover:text-[#F2F3F5] text-xs mb-6 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Wrong email? Go back
      </button>

      <p className="text-[#9CA3AF] text-sm mb-2">
        We sent a 6-digit code to
      </p>
      <p className="text-[#F2F3F5] font-medium text-sm mb-6 break-all">{email}</p>

      {error && <p className="text-[#ef4444] text-xs mb-4">{error}</p>}

      <motion.div
        className="flex gap-2 justify-center mb-6"
        animate={shake ? { x: [0, -8, 8, -8, 8, -4, 4, 0] } : {}}
        transition={{ duration: 0.4 }}
        onPaste={handlePaste}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={d}
            disabled={loading}
            onChange={e => handleDigit(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            className="w-11 h-12 text-center text-[#F2F3F5] text-xl font-bold bg-[#0f0f10] border border-[#1f2022] focus:border-[#FF4500] focus:outline-none disabled:opacity-50 transition-colors"
          />
        ))}
      </motion.div>

      <Button
        onClick={() => submitOtp(digits)}
        disabled={loading || digits.join('').length < 6}
        className="w-full h-11 bg-[#FF4500] hover:bg-[#e63e00] text-white font-medium transition-colors rounded-none disabled:opacity-60 mb-4"
      >
        {loading ? 'Verifying…' : 'Verify'}
      </Button>

      <p className="text-xs text-center text-[#9CA3AF]">
        Didn't receive it?{' '}
        <button
          onClick={handleResend}
          disabled={cooldown > 0}
          className="text-[#FF4500] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
      </p>
    </div>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────────

export default function SignupPage() {
  const [step,  setStep]  = useState(1);
  const [email, setEmail] = useState('');

  const handleSignupSuccess = (submittedEmail) => {
    setEmail(submittedEmail);
    setStep(2);
  };

  return (
    <div className="min-h-screen flex bg-[#0f0f10] text-[#F2F3F5] items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md p-10 bg-[#141416] border border-[#1f2022] shadow-2xl"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-[#FF4500] flex items-center justify-center shrink-0">
            <BarChart2 className="w-5 h-5 text-white" />
          </div>
          <span className="font-['Space_Grotesk'] text-[#F2F3F5] text-2xl font-bold tracking-tight">
            Sales Copilot
          </span>
        </div>

        <div className="mb-8">
          <h3 className="font-['Space_Grotesk'] text-[#F2F3F5] text-xl font-bold mb-2">
            {step === 1 ? 'Create your account' : 'Verify your email'}
          </h3>
          <p className="text-[#9CA3AF] text-sm">
            {step === 1
              ? 'Sign up to access your workspace.'
              : 'Enter the code we sent to your email.'}
          </p>
        </div>

        {step === 1 ? (
          <RegistrationForm onSuccess={handleSignupSuccess} />
        ) : (
          <OtpVerification email={email} onBack={() => setStep(1)} />
        )}
      </motion.div>
    </div>
  );
}
