import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Trash2, Star, StarOff, FileSpreadsheet, Loader2,
  CheckCircle, AlertCircle, ChevronDown, ChevronRight, Search,
  Plus, Play, Eye, Zap, X, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';

const CARD_VARIANTS = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const ACTIVITY_TYPES = [
  { value: 'appointment', label: 'Appointment' },
  { value: 'phonecall',   label: 'Phone Call' },
  { value: 'task',        label: 'Task' },
];

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

const EMPTY_RULE_FORM = {
  name: '',
  activity_type: 'appointment',
  subject_template: 'Activity with {name}',
  duration_minutes: 30,
  notes_template: '',
};

export default function FileManagementPage() {
  // ── File state ──────────────────────────────────────────────────────────────
  const [files, setFiles]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [uploading, setUploading]       = useState(false);
  const [dragOver, setDragOver]         = useState(false);
  const [expandedFileId, setExpandedFileId] = useState(null);
  const [accountsState, setAccountsState]   = useState({});
  const fileInputRef  = useRef(null);
  const searchTimers  = useRef({});

  // ── Rules state ─────────────────────────────────────────────────────────────
  const [rules, setRules]               = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [ruleForm, setRuleForm]         = useState(EMPTY_RULE_FORM);
  const [creatingRule, setCreatingRule] = useState(false);

  // Preview modal
  const [preview, setPreview] = useState({ open: false, rule: null, rows: [], loading: false });

  // Job progress modal
  const [job, setJob] = useState({ open: false, jobId: null, total: 0, done: 0, failed: 0, status: 'running', rows: [] });
  const jobPollRef = useRef(null);

  // ── Load files ───────────────────────────────────────────────────────────────
  const loadFiles = () => {
    setLoading(true);
    api.get('/files/')
      .then((res) => setFiles(Array.isArray(res?.data?.files) ? res.data.files : []))
      .catch((err) => toast.error('Failed to load files', { description: err?.message }))
      .finally(() => setLoading(false));
  };

  // ── Load rules ───────────────────────────────────────────────────────────────
  const loadRules = useCallback(() => {
    setRulesLoading(true);
    api.get('/excel/rules')
      .then((res) => setRules(res?.data?.rules || []))
      .catch(() => toast.error('Failed to load rules'))
      .finally(() => setRulesLoading(false));
  }, []);

  useEffect(() => { loadFiles(); loadRules(); }, [loadRules]);

  // ── Upload ───────────────────────────────────────────────────────────────────
  const uploadFile = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      toast.error('Unsupported file type', { description: 'Only .xlsx or .csv files supported.' });
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL || ''}/api/files/upload-accounts`, {
        method: 'POST', credentials: 'include', body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || json.detail || 'Upload failed');
      toast.success('File uploaded', {
        description: `${json.data.imported_accounts} accounts imported from ${json.data.filename}.`,
      });
      loadFiles();
    } catch (err) {
      toast.error('Upload failed', { description: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f); };
  const handleFileInput = (e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; };

  // ── Set default ──────────────────────────────────────────────────────────────
  const setDefault = async (fileId) => {
    try {
      await api.post(`/files/${fileId}/set-default`);
      setFiles((prev) => prev.map((f) => ({ ...f, is_default: f.file_id === fileId })));
      toast.success('Default file updated');
    } catch { toast.error('Failed to update default'); }
  };

  // ── Delete file ──────────────────────────────────────────────────────────────
  const deleteFile = async (fileId, filename) => {
    if (!window.confirm(`Delete "${filename}"? This removes all imported accounts.`)) return;
    try {
      await api.delete(`/files/${fileId}`);
      setFiles((prev) => prev.filter((f) => f.file_id !== fileId));
      if (expandedFileId === fileId) setExpandedFileId(null);
      toast.success('File deleted');
    } catch { toast.error('Failed to delete file'); }
  };

  // ── Expand / account preview ─────────────────────────────────────────────────
  const fetchAccounts = useCallback(async (fileId, q = '') => {
    setAccountsState((prev) => ({ ...prev, [fileId]: { ...prev[fileId], loading: true, q } }));
    try {
      const res = await api.get(`/files/${fileId}/accounts?q=${encodeURIComponent(q)}&limit=100`);
      setAccountsState((prev) => ({ ...prev, [fileId]: { loading: false, accounts: res?.data?.accounts || [], q } }));
    } catch {
      setAccountsState((prev) => ({ ...prev, [fileId]: { loading: false, accounts: [], q } }));
    }
  }, []);

  const toggleExpand = async (fileId) => {
    if (expandedFileId === fileId) { setExpandedFileId(null); return; }
    setExpandedFileId(fileId);
    if (!accountsState[fileId]) await fetchAccounts(fileId, '');
  };

  const handleAccountSearch = (fileId, q) => {
    setAccountsState((prev) => ({ ...prev, [fileId]: { ...prev[fileId], q } }));
    clearTimeout(searchTimers.current[fileId]);
    searchTimers.current[fileId] = setTimeout(() => fetchAccounts(fileId, q), 300);
  };

  // ── Create rule ───────────────────────────────────────────────────────────────
  const handleCreateRule = async (e) => {
    e.preventDefault();
    if (!ruleForm.name.trim())             { toast.error('Rule name is required'); return; }
    if (!ruleForm.subject_template.trim()) { toast.error('Subject template is required'); return; }
    setCreatingRule(true);
    try {
      const res = await api.post('/excel/rules', {
        name: ruleForm.name.trim(),
        activity_type: ruleForm.activity_type,
        subject_template: ruleForm.subject_template.trim(),
        duration_minutes: Number(ruleForm.duration_minutes),
        notes_template: ruleForm.notes_template.trim(),
        account_filter: 'all',
      });
      setRules((prev) => [res.data.rule, ...prev]);
      setRuleForm(EMPTY_RULE_FORM);
      setShowCreateRule(false);
      toast.success('Rule created');
    } catch (err) {
      toast.error('Failed to create rule', { description: err?.response?.data?.detail || err.message });
    } finally {
      setCreatingRule(false);
    }
  };

  // ── Delete rule ───────────────────────────────────────────────────────────────
  const handleDeleteRule = async (ruleId, ruleName) => {
    if (!window.confirm(`Delete rule "${ruleName}"?`)) return;
    try {
      await api.delete(`/excel/rules/${ruleId}`);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      toast.success('Rule deleted');
    } catch { toast.error('Failed to delete rule'); }
  };

  // ── Preview rule ──────────────────────────────────────────────────────────────
  const handlePreview = async (rule) => {
    setPreview({ open: true, rule, rows: [], loading: true });
    try {
      const res = await api.post(`/excel/rules/${rule.id}/preview`);
      setPreview((prev) => ({ ...prev, rows: res?.data?.rows || [], loading: false }));
    } catch (err) {
      setPreview((prev) => ({ ...prev, loading: false }));
      toast.error('Preview failed', { description: err?.response?.data?.detail || err.message });
    }
  };

  // ── Run rule ──────────────────────────────────────────────────────────────────
  const startRun = async (rule) => {
    setPreview({ open: false, rule: null, rows: [], loading: false });
    try {
      const res = await api.post(`/excel/rules/${rule.id}/execute`, { account_ids: null });
      const { job_id, total } = res.data;
      setJob({ open: true, jobId: job_id, total, done: 0, failed: 0, status: 'running', rows: [] });
      clearInterval(jobPollRef.current);
      jobPollRef.current = setInterval(() => pollJob(job_id), 2000);
    } catch (err) {
      toast.error('Failed to start run', { description: err?.response?.data?.detail || err.message });
    }
  };

  const pollJob = async (jobId) => {
    try {
      const res = await api.get(`/excel/jobs/${jobId}`);
      const d = res?.data;
      setJob((prev) => ({ ...prev, total: d.total, done: d.done, failed: d.failed, status: d.status, rows: Array.isArray(d.rows) ? d.rows : [] }));
      if (d.status === 'complete') {
        clearInterval(jobPollRef.current);
        jobPollRef.current = null;
        toast.success(`Bulk run complete — ${d.done} logged, ${d.failed} failed`);
      }
    } catch { /* silent retry */ }
  };

  const closeJob = () => {
    clearInterval(jobPollRef.current);
    jobPollRef.current = null;
    setJob({ open: false, jobId: null, total: 0, done: 0, failed: 0, status: 'running', rows: [] });
  };

  useEffect(() => () => clearInterval(jobPollRef.current), []);

  // Duplicate MDM detection for preview warning
  const previewDuplicates = (() => {
    const counts = {};
    for (const row of preview.rows) {
      const id = row.mdm_id || row.account_id;
      if (id) counts[id] = (counts[id] || 0) + 1;
    }
    return Object.entries(counts).filter(([, c]) => c > 1).map(([id]) => id);
  })();

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <FileSpreadsheet className="w-5 h-5 text-[#FF4500]" />
          <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5]">File Management</h1>
        </div>
        <p className="text-[#9CA3AF] text-sm">
          Upload Excel or CSV account lists. Set one as default to power account search and automation rules.
        </p>
      </div>

      {/* Upload area */}
      <motion.div variants={CARD_VARIANTS} initial="hidden" animate="visible">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`relative bg-[#141416] border-2 border-dashed p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
            dragOver ? 'border-[#FF4500] bg-[#FF4500]/5' : 'border-[#1f2022] hover:border-[#FF4500]/40'
          } ${uploading ? 'pointer-events-none' : ''}`}
        >
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInput} />
          {uploading ? <Loader2 className="w-8 h-8 text-[#FF4500] animate-spin" /> : <Upload className="w-8 h-8 text-[#9CA3AF]" />}
          <div className="text-center">
            <p className="text-[#F2F3F5] text-sm font-medium">{uploading ? 'Uploading…' : 'Drop your file here or click to browse'}</p>
            <p className="text-[#9CA3AF] text-xs mt-1">.xlsx, .xls, .csv — your account list</p>
          </div>
        </div>
      </motion.div>

      {/* Column detection note */}
      <div className="mt-3 mb-6 flex items-start gap-2 text-xs text-[#9CA3AF]">
        <CheckCircle className="w-3.5 h-3.5 text-[#22c55e] shrink-0 mt-0.5" />
        <span>
          Columns auto-detected: <strong className="text-[#F2F3F5]">IDG</strong> → MDM ID (IDG),{' '}
          <strong className="text-[#F2F3F5]">ISG</strong> → MDM ID (ISG),{' '}
          <strong className="text-[#F2F3F5]">party_name / account name / customer name</strong> → account name.
        </span>
      </div>

      {/* Files table */}
      <div>
        <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5] mb-3">Uploaded Files</h2>
        {loading ? (
          <div className="bg-[#141416] border border-[#1f2022] p-8 flex justify-center">
            <Loader2 className="w-5 h-5 text-[#9CA3AF] animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="bg-[#141416] border border-[#1f2022] p-10 flex flex-col items-center gap-2 text-[#9CA3AF]">
            <FileSpreadsheet className="w-8 h-8 opacity-40" />
            <p className="text-sm">No files uploaded yet</p>
          </div>
        ) : (
          <div className="bg-[#141416] border border-[#1f2022] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1f2022]">
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider w-8"></th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Filename</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Accounts</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden md:table-cell">Uploaded</th>
                  <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <Fragment key={f.file_id}>
                    <tr
                      className="border-b border-[#1f2022] hover:bg-[#1f2022]/30 cursor-pointer transition-colors"
                      onClick={() => toggleExpand(f.file_id)}
                    >
                      <td className="px-4 py-3 text-[#9CA3AF]">
                        {expandedFileId === f.file_id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                          <span className="text-[#F2F3F5] text-sm truncate max-w-[200px]">{f.filename}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#9CA3AF] text-sm">{f.row_count?.toLocaleString()}</td>
                      <td className="px-4 py-3 text-[#9CA3AF] text-xs hidden md:table-cell">
                        {f.uploaded_at ? new Date(f.uploaded_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {f.is_default
                          ? <Badge className="bg-[#FF4500]/10 text-[#FF4500] border-[#FF4500]/20 rounded-none text-[10px] px-2 py-0.5 hover:bg-[#FF4500]/10">Default</Badge>
                          : <span className="text-[#9CA3AF] text-xs">—</span>
                        }
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {!f.is_default && (
                            <button onClick={() => setDefault(f.file_id)} title="Set as default"
                              className="w-7 h-7 flex items-center justify-center text-[#9CA3AF] hover:text-[#FF4500] transition-colors">
                              <StarOff className="w-4 h-4" />
                            </button>
                          )}
                          {f.is_default && (
                            <button disabled title="Default file"
                              className="w-7 h-7 flex items-center justify-center text-[#FF4500] opacity-60 cursor-default">
                              <Star className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => deleteFile(f.file_id, f.filename)} title="Delete file"
                            className="w-7 h-7 flex items-center justify-center text-[#9CA3AF] hover:text-[#ef4444] transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    <AnimatePresence>
                      {expandedFileId === f.file_id && (
                        <tr className="border-b border-[#1f2022]">
                          <td colSpan={6} className="px-4 pb-4 pt-0">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="bg-[#0f0f10] border border-[#1f2022] mt-2">
                                <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1f2022]">
                                  <Search className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
                                  <input
                                    type="text" placeholder="Search accounts in this file…"
                                    value={accountsState[f.file_id]?.q || ''}
                                    onChange={(e) => handleAccountSearch(f.file_id, e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="bg-transparent text-[#F2F3F5] text-xs outline-none flex-1 placeholder:text-[#9CA3AF]"
                                  />
                                  {accountsState[f.file_id]?.loading && <Loader2 className="w-3.5 h-3.5 text-[#9CA3AF] animate-spin shrink-0" />}
                                </div>
                                <div className="max-h-60 overflow-y-auto">
                                  {accountsState[f.file_id]?.loading && !accountsState[f.file_id]?.accounts?.length ? (
                                    <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-[#9CA3AF]" /></div>
                                  ) : accountsState[f.file_id]?.accounts?.length === 0 ? (
                                    <p className="text-center text-xs text-[#9CA3AF] py-6">No accounts found</p>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead className="sticky top-0 bg-[#0f0f10]">
                                        <tr className="border-b border-[#1f2022]">
                                          <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium">Account Name</th>
                                          <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium">MDM ID (IDG)</th>
                                          <th className="px-3 py-2 text-left text-[#9CA3AF] font-medium hidden sm:table-cell">MDM ID (ISG)</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {accountsState[f.file_id].accounts.map((a, i) => (
                                          <tr key={i} className="border-b border-[#1f2022]/40 last:border-0">
                                            <td className="px-3 py-1.5 text-[#F2F3F5]">{a.account_name || '—'}</td>
                                            <td className="px-3 py-1.5 text-[#9CA3AF] font-mono">{a.l2_mdm_id_idg || '—'}</td>
                                            <td className="px-3 py-1.5 text-[#9CA3AF] font-mono hidden sm:table-cell">{a.l2_mdm_id_isg || '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                                <div className="px-3 py-2 border-t border-[#1f2022] text-[10px] text-[#9CA3AF]">
                                  Showing {accountsState[f.file_id]?.accounts?.length || 0} of {f.row_count?.toLocaleString()} accounts
                                  {accountsState[f.file_id]?.q && ' matching search'}
                                </div>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─────────────────── Automation Rules ─────────────────────────────────── */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#FF4500]" />
            <h2 className="font-['Space_Grotesk'] text-base font-semibold text-[#F2F3F5]">Automation Rules</h2>
          </div>
          <button
            onClick={() => setShowCreateRule((v) => !v)}
            className="flex items-center gap-1.5 h-8 px-3 bg-[#FF4500] hover:bg-[#FF4500]/80 text-white text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {showCreateRule ? 'Cancel' : 'Create Rule'}
          </button>
        </div>
        <p className="text-[#9CA3AF] text-xs mb-4">
          Define rules to bulk-log D365 activities for every account in your default file. Each rule runs against the live default account list.
        </p>

        {/* Create rule form */}
        <AnimatePresence>
          {showCreateRule && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
              className="overflow-hidden mb-4"
            >
              <form onSubmit={handleCreateRule} className="bg-[#141416] border border-[#FF4500]/20 p-5 space-y-4">
                <p className="text-xs font-medium text-[#FF4500] uppercase tracking-wider">New Rule</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[#9CA3AF] mb-1">Rule Name</label>
                    <input type="text" value={ruleForm.name}
                      onChange={(e) => setRuleForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Weekly Q3 check-in"
                      className="w-full h-9 px-3 bg-[#0f0f10] border border-[#1f2022] text-[#F2F3F5] text-sm placeholder-[#9CA3AF] focus:outline-none focus:border-[#FF4500] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#9CA3AF] mb-1">Activity Type</label>
                    <select value={ruleForm.activity_type}
                      onChange={(e) => setRuleForm((p) => ({ ...p, activity_type: e.target.value }))}
                      className="w-full h-9 px-3 bg-[#0f0f10] border border-[#1f2022] text-[#F2F3F5] text-sm focus:outline-none focus:border-[#FF4500] transition-colors appearance-none"
                    >
                      {ACTIVITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-[#9CA3AF] mb-1">
                      Subject Template
                      <span className="ml-1 text-[#9CA3AF]/60">— use <code className="text-[#FF4500]">{'{name}'}</code> for account name</span>
                    </label>
                    <input type="text" value={ruleForm.subject_template}
                      onChange={(e) => setRuleForm((p) => ({ ...p, subject_template: e.target.value }))}
                      placeholder="e.g. Q3 check-in with {name}"
                      className="w-full h-9 px-3 bg-[#0f0f10] border border-[#1f2022] text-[#F2F3F5] text-sm placeholder-[#9CA3AF] focus:outline-none focus:border-[#FF4500] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#9CA3AF] mb-1">Duration (minutes)</label>
                    <select value={ruleForm.duration_minutes}
                      onChange={(e) => setRuleForm((p) => ({ ...p, duration_minutes: Number(e.target.value) }))}
                      className="w-full h-9 px-3 bg-[#0f0f10] border border-[#1f2022] text-[#F2F3F5] text-sm focus:outline-none focus:border-[#FF4500] transition-colors appearance-none"
                    >
                      {DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#9CA3AF] mb-1">Notes Template <span className="text-[#9CA3AF]/60">(optional)</span></label>
                    <input type="text" value={ruleForm.notes_template}
                      onChange={(e) => setRuleForm((p) => ({ ...p, notes_template: e.target.value }))}
                      placeholder="e.g. Automated log for {name}"
                      className="w-full h-9 px-3 bg-[#0f0f10] border border-[#1f2022] text-[#F2F3F5] text-sm placeholder-[#9CA3AF] focus:outline-none focus:border-[#FF4500] transition-colors"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={creatingRule}
                    className="h-9 px-5 bg-[#FF4500] hover:bg-[#FF4500]/80 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
                    {creatingRule && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Create Rule
                  </button>
                  <button type="button" onClick={() => { setShowCreateRule(false); setRuleForm(EMPTY_RULE_FORM); }}
                    className="h-9 px-5 bg-[#1f2022] hover:bg-[#1f2022]/70 text-[#9CA3AF] text-sm transition-colors">
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rules list */}
        {rulesLoading ? (
          <div className="bg-[#141416] border border-[#1f2022] p-8 flex justify-center">
            <Loader2 className="w-5 h-5 text-[#9CA3AF] animate-spin" />
          </div>
        ) : rules.length === 0 ? (
          <div className="bg-[#141416] border border-[#1f2022] p-10 flex flex-col items-center gap-2 text-[#9CA3AF]">
            <Zap className="w-8 h-8 opacity-30" />
            <p className="text-sm">No automation rules yet</p>
            <p className="text-xs opacity-60">Create a rule to bulk-log activities for all accounts in your default file</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="bg-[#141416] border border-[#1f2022] px-4 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[#F2F3F5] truncate">{rule.name}</span>
                    <Badge className={`rounded-none text-[10px] px-1.5 py-0 border hover:bg-inherit ${
                      rule.activity_type === 'appointment' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      : rule.activity_type === 'phonecall' ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    }`}>
                      {ACTIVITY_TYPES.find((t) => t.value === rule.activity_type)?.label || rule.activity_type}
                    </Badge>
                  </div>
                  <p className="text-xs text-[#9CA3AF] mt-0.5 truncate">
                    "{rule.subject_template}" · {rule.duration_minutes} min
                    {rule.notes_template ? ` · ${rule.notes_template}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handlePreview(rule)} title="Preview accounts"
                    className="flex items-center gap-1 h-7 px-2.5 text-xs text-[#9CA3AF] hover:text-[#F2F3F5] border border-[#1f2022] hover:border-[#9CA3AF] transition-colors">
                    <Eye className="w-3.5 h-3.5" />Preview
                  </button>
                  <button onClick={() => startRun(rule)} title="Run rule"
                    className="flex items-center gap-1 h-7 px-2.5 text-xs text-white bg-[#FF4500] hover:bg-[#FF4500]/80 transition-colors">
                    <Play className="w-3.5 h-3.5" />Run
                  </button>
                  <button onClick={() => handleDeleteRule(rule.id, rule.name)} title="Delete rule"
                    className="w-7 h-7 flex items-center justify-center text-[#9CA3AF] hover:text-[#ef4444] transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="mt-8 bg-[#141416] border border-[#1f2022] p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="w-4 h-4 text-[#9CA3AF]" />
          <p className="text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">How it works</p>
        </div>
        <ul className="space-y-1.5 text-xs text-[#9CA3AF]">
          <li>• Upload your account list — the file is parsed and stored in the database.</li>
          <li>• Set one file as <strong className="text-[#F2F3F5]">Default</strong> — it powers account search in activity forms and automation rules.</li>
          <li>• Click any file row to expand and preview or search the accounts inside it.</li>
          <li>• <strong className="text-[#F2F3F5]">Automation Rules</strong> — create a rule, preview which accounts will be logged, then hit Run to bulk-log to D365 in the background.</li>
          <li>• MDM IDs starting with <strong className="text-[#FF4500]">PA0</strong> are highlighted in previews. Duplicate MDM IDs trigger a conflict warning before running.</li>
        </ul>
      </div>

      {/* ── Preview Modal ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {preview.open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setPreview((p) => ({ ...p, open: false }))}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }} transition={{ duration: 0.15 }}
              className="bg-[#141416] border border-[#1f2022] w-full max-w-2xl max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f2022]">
                <div>
                  <p className="font-['Space_Grotesk'] text-sm font-semibold text-[#F2F3F5]">Preview: {preview.rule?.name}</p>
                  <p className="text-xs text-[#9CA3AF] mt-0.5">
                    {preview.loading ? 'Loading…' : `${preview.rows.length} accounts will be logged`}
                  </p>
                </div>
                <button onClick={() => setPreview((p) => ({ ...p, open: false }))}
                  className="w-7 h-7 flex items-center justify-center text-[#9CA3AF] hover:text-[#F2F3F5] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {previewDuplicates.length > 0 && (
                <div className="mx-5 mt-3 flex items-start gap-2 p-3 bg-yellow-500/5 border border-yellow-500/20 text-xs text-yellow-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{previewDuplicates.length} duplicate MDM {previewDuplicates.length === 1 ? 'ID' : 'IDs'} detected — these accounts will each be logged individually.</span>
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {preview.loading ? (
                  <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-[#9CA3AF]" /></div>
                ) : preview.rows.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-[#9CA3AF]">
                    <AlertCircle className="w-6 h-6 opacity-40" />
                    <p className="text-sm">No accounts in default file</p>
                    <p className="text-xs opacity-60">Upload a file and set it as default first</p>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#141416]">
                      <tr className="border-b border-[#1f2022]">
                        <th className="px-5 py-2.5 text-left text-[#9CA3AF] font-medium">Account</th>
                        <th className="px-5 py-2.5 text-left text-[#9CA3AF] font-medium">MDM ID</th>
                        <th className="px-5 py-2.5 text-left text-[#9CA3AF] font-medium">Subject</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => {
                        const mdmId = row.mdm_id || row.account_id || '';
                        const isPA  = mdmId.toUpperCase().startsWith('PA0');
                        const isDup = previewDuplicates.includes(mdmId);
                        return (
                          <tr key={i} className={`border-b border-[#1f2022]/40 last:border-0 ${isDup ? 'bg-yellow-500/5' : ''}`}>
                            <td className="px-5 py-2 text-[#F2F3F5]">{row.name || '—'}</td>
                            <td className="px-5 py-2 font-mono">
                              {mdmId ? <span className={isPA ? 'text-[#FF4500]' : 'text-[#9CA3AF]'}>{mdmId}</span>
                                     : <span className="text-[#9CA3AF]/50">—</span>}
                            </td>
                            <td className="px-5 py-2 text-[#9CA3AF]">{row.subject || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-t border-[#1f2022]">
                <span className="text-xs text-[#9CA3AF]">{preview.rows.length} accounts · {preview.rule?.activity_type}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPreview((p) => ({ ...p, open: false }))}
                    className="h-8 px-4 text-xs text-[#9CA3AF] border border-[#1f2022] hover:border-[#9CA3AF] transition-colors">
                    Close
                  </button>
                  {preview.rows.length > 0 && (
                    <button onClick={() => startRun(preview.rule)}
                      className="h-8 px-4 text-xs text-white bg-[#FF4500] hover:bg-[#FF4500]/80 flex items-center gap-1.5 transition-colors">
                      <Play className="w-3 h-3" />Run Now ({preview.rows.length})
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Job Progress Modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {job.open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.2 }}
              className="bg-[#141416] border border-[#1f2022] w-full max-w-xl"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f2022]">
                <div className="flex items-center gap-2">
                  {job.status === 'running'
                    ? <Loader2 className="w-4 h-4 text-[#FF4500] animate-spin" />
                    : <CheckCircle className="w-4 h-4 text-[#22c55e]" />}
                  <p className="font-['Space_Grotesk'] text-sm font-semibold text-[#F2F3F5]">
                    {job.status === 'running' ? 'Logging Activities…' : 'Bulk Run Complete'}
                  </p>
                </div>
                {job.status === 'complete' && (
                  <button onClick={closeJob}
                    className="w-7 h-7 flex items-center justify-center text-[#9CA3AF] hover:text-[#F2F3F5] transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="px-5 py-4 space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-[#9CA3AF] mb-1.5">
                    <span>{job.done} of {job.total} logged</span>
                    {job.failed > 0 && <span className="text-[#ef4444]">{job.failed} failed</span>}
                  </div>
                  <div className="h-1.5 bg-[#1f2022] overflow-hidden">
                    <motion.div className="h-full bg-[#FF4500]"
                      animate={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                </div>

                {job.rows.filter((r) => r.status !== 'pending').length > 0 && (
                  <div className="max-h-48 overflow-y-auto space-y-0.5">
                    {job.rows.filter((r) => r.status !== 'pending').slice(-20).map((row, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-[#1f2022]/30 last:border-0">
                        <span className="text-[#9CA3AF] truncate flex-1">{row.name || row.account_id || '—'}</span>
                        <span className={`ml-2 shrink-0 ${
                          row.status === 'success' ? 'text-[#22c55e]' :
                          row.status === 'failed'  ? 'text-[#ef4444]' : 'text-[#9CA3AF]'
                        }`}>
                          {row.status === 'success' ? 'Logged' : row.status === 'failed' ? 'Failed' : 'Pending'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {job.status === 'complete' && (
                  <button onClick={closeJob}
                    className="h-8 px-4 text-xs text-white bg-[#FF4500] hover:bg-[#FF4500]/80 transition-colors">
                    Done
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
