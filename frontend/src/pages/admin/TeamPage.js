import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';

const memberSchema = z.object({
  display_name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  role: z.enum(['rep', 'admin']),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const ROLE_BADGE = {
  admin: 'bg-[#FF4500]/10 text-[#FF4500] border-[#FF4500]/20',
  rep:   'bg-[#1f2022] text-[#9CA3AF] border-[#1f2022]',
};

export default function TeamPage() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState(null); // email to remove
  const [saving, setSaving] = useState(false);

  const { register, handleSubmit, formState: { errors }, setValue, reset } = useForm({
    resolver: zodResolver(memberSchema),
    defaultValues: { role: 'rep' },
  });

  const loadMembers = () => {
    api.get('/team')
      .then(setMembers)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadMembers(); }, []);

  const onAddMember = async (values) => {
    setSaving(true);
    try {
      await api.post('/team', values);
      toast.success('Team member added', { description: values.email });
      setAddOpen(false);
      reset();
      loadMembers();
    } catch (err) {
      toast.error('Failed to add member', { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await api.delete(`/team/${encodeURIComponent(removing)}`);
      toast.success('Member removed');
      setRemoving(null);
      loadMembers();
    } catch (err) {
      toast.error('Failed to remove member', { description: err.message });
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-[#FF4500]" />
          <div>
            <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5]">Team</h1>
            <p className="text-[#9CA3AF] text-sm">Manage who has access to Sales Copilot.</p>
          </div>
        </div>
        <Button
          onClick={() => { reset(); setAddOpen(true); }}
          className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-9 px-4 text-sm transition-colors"
        >
          <Plus className="w-4 h-4 mr-1.5" /> Add Member
        </Button>
      </div>

      {/* Members table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-[#141416] border border-[#1f2022] overflow-hidden"
      >
        {loading ? (
          <div className="p-10 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-[#FF4500] animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="p-10 text-center text-[#9CA3AF] text-sm">No team members yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1f2022]">
                <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden lg:table-cell">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.email} className="border-b border-[#1f2022] last:border-0 hover:bg-[#1f2022]/40 transition-colors">
                  <td className="px-4 py-3 text-[#F2F3F5] font-medium">{m.display_name}</td>
                  <td className="px-4 py-3 text-[#9CA3AF]">{m.email}</td>
                  <td className="px-4 py-3">
                    <Badge className={`rounded-none text-xs ${ROLE_BADGE[m.role] || ROLE_BADGE.rep}`}>
                      {m.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-[#9CA3AF] text-xs hidden lg:table-cell">
                    {m.added_at ? new Date(m.added_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoving(m.email)}
                      className="text-[#9CA3AF] hover:text-[#ef4444] hover:bg-[#ef4444]/10 rounded-none h-7 w-7 p-0 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </motion.div>

      {/* Add member dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent
          className="bg-[#141416] border border-[#1f2022] text-[#F2F3F5] max-w-md rounded-none p-0 gap-0"
        >
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-[#1f2022]">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-5 h-5 text-[#FF4500]" />
              <DialogTitle className="font-['Space_Grotesk'] text-lg font-bold">Add Team Member</DialogTitle>
            </div>
            <DialogDescription className="text-[#9CA3AF] text-sm">
              Add a team member and set their initial login password.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onAddMember)} className="px-6 py-5 space-y-4">
            <div>
              <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Full Name</Label>
              <Input
                {...register('display_name')}
                placeholder="Jane Doe"
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-9 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
              />
              {errors.display_name && (
                <p className="text-xs text-[#ef4444] mt-1">{errors.display_name.message}</p>
              )}
            </div>

            <div>
              <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Work Email</Label>
              <Input
                {...register('email')}
                type="email"
                placeholder="jane@company.com"
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-9 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
              />
              {errors.email && (
                <p className="text-xs text-[#ef4444] mt-1">{errors.email.message}</p>
              )}
            </div>

            <div>
              <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Initial Password</Label>
              <Input
                {...register('password')}
                type="password"
                placeholder="Min. 8 characters"
                className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-9 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]"
              />
              {errors.password && (
                <p className="text-xs text-[#ef4444] mt-1">{errors.password.message}</p>
              )}
            </div>

            <div>
              <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Role</Label>
              <Select onValueChange={(v) => setValue('role', v)} defaultValue="rep">
                <SelectTrigger
                  className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm focus:ring-[#FF4500]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                  <SelectItem value="rep"   className="focus:bg-[#1f2022]">Sales Rep</SelectItem>
                  <SelectItem value="admin" className="focus:bg-[#1f2022]">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#1f2022]">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAddOpen(false)}
                className="text-[#9CA3AF] border border-[#1f2022] hover:bg-[#1f2022] rounded-none h-8 text-xs transition-colors"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 px-4 text-xs transition-colors disabled:opacity-60"
              >
                {saving ? 'Adding…' : 'Add Member'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent className="bg-[#141416] border border-[#1f2022] text-[#F2F3F5] rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-['Space_Grotesk'] text-[#F2F3F5]">Remove member?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#9CA3AF]">
              <strong className="text-[#F2F3F5]">{removing}</strong> will lose access immediately.
              They can be re-added at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-transparent border-[#1f2022] text-[#9CA3AF] hover:bg-[#1f2022] rounded-none"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-[#ef4444] hover:bg-[#dc2626] text-white rounded-none border-0"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
