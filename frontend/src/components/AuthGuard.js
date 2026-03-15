import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';

/**
 * Wraps a route — redirects to /login if unauthenticated.
 * If requireAdmin=true, redirects to /dashboard if user is not admin.
 * Exposes the authenticated user via the `user` render prop.
 */
export default function AuthGuard({ children, requireAdmin = false }) {
  const [status, setStatus] = useState('loading'); // loading | ok | unauth | forbidden
  const [user, setUser] = useState(null);

  useEffect(() => {
    api.get('/auth/me')
      .then((u) => {
        setUser(u);
        if (requireAdmin && u.role !== 'admin') {
          setStatus('forbidden');
        } else {
          setStatus('ok');
        }
      })
      .catch(() => setStatus('unauth'));
  }, [requireAdmin]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#0f0f10] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#FF4500] animate-spin" />
      </div>
    );
  }
  if (status === 'unauth') return <Navigate to="/login" replace />;
  if (status === 'forbidden') return <Navigate to="/dashboard" replace />;

  return typeof children === 'function' ? children(user) : children;
}
