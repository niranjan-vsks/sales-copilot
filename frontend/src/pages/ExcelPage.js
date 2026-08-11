import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Plus, Play, Eye, Trash2, ExternalLink, CheckSquare, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import api from '@/lib/api';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

const INPUT_CLS = 'bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] placeholder:text-[#9CA3AF]/60 rounded-none h-9 text-sm focus-visible:ring-[#FF4500] focus-visible:border-[#FF4500]';

const ACTIVITY_LABELS = { phonecall: 'Phone Call', task: 'Task', appointment: 'Meeting' };

// ── Upload a file without the JSON Content-Type header ────────────────────────
async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BACKEND_URL}/api/excel/upload`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (res.status === 401) { window.location.href = '/#/login'; throw new Error('Not authenticated'); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Upload failed: ${res.status}`);
  }
  const data = await res.json();
  return data.data;
}

// ── Tab button ────────────────────────────────────────────────────────────────
function Tab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 h-9 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-[#FF4500] text-[#F2F3F5]'
          : 'border-transparent text-[#9CA3AF] hover:text-[#F2F3F5]'
      }`}
    >
      {label}
    </button>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    success: 'text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/20',
    pending: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
    failed:  'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/20',
    running: 'text-[#60a5fa] bg-[#60a5fa]/10 border-[#60a5fa]/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs border rounded-none font-medium ${map[status] || map.pending}`}>
      {status}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function ExcelPage() {
  const [activeTab, setActiveTab] = useState('accounts');

  // ── Accounts tab state ───────────────────────────────────────────────────
  const [dragging, setDragging]       = useState(false);
  const [uploadResult, setUploadResult] = useState(null); // {columns, preview, all_rows, total_rows}
  const [idCol, setIdCol]             = useState('');
  const [nameCol, setNameCol]         = useState('');
  const [importing, setImporting]     = useState(false);
  const [accounts, setAccounts]       = useState([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountsLoading, setAccountsLoading] = useState(false);
  const fileInputRef = useRef(null);

  // ── Rules tab state ──────────────────────────────────────────────────────
  const [rules, setRules]             = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [ruleName, setRuleName]       = useState('');
  const [ruleType, setRuleType]       = useState('phonecall');
  const [ruleSubject, setRuleSubject] = useState('');
  const [ruleDuration, setRuleDuration] = useState('30');
  const [ruleNotes, setRuleNotes]     = useState('');
  const [ruleFilter, setRuleFilter]   = useState('all');
  const [savingRule, setSavingRule]   = useState(false);

  // ── Preview modal ────────────────────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRule, setPreviewRule] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set()); // Set of account_ids

  // ── Job progress modal ───────────────────────────────────────────────────
  const [jobOpen, setJobOpen]         = useState(false);
  const [jobData, setJobData]         = useState(null);
  const pollRef                       = useRef(null);

  // ── Load accounts ────────────────────────────────────────────────────────
  const loadAccounts = useCallback((q = '') => {
    setAccountsLoading(true);
    api.get(`/excel/accounts?search=${encodeURIComponent(q)}&limit=100`)
      .then((d) => setAccounts(d.data?.accounts || []))
      .catch(() => {})
      .finally(() => setAccountsLoading(false));
  }, []);

  const loadRules = useCallback(() => {
    setRulesLoading(true);
    api.get('/excel/rules')
      .then((d) => setRules(d.data?.rules || []))
      .catch(() => {})
      .finally(() => setRulesLoading(false));
  }, []);

  useEffect(() => { loadAccounts(); loadRules(); }, [loadAccounts, loadRules]);

  // ── File drag/drop ───────────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    try {
      const result = await uploadFile(file);
      setUploadResult(result);
      // Auto-guess columns
      const cols = result.columns || [];
      const idGuess = cols.find((c) => /id|mdm|code/i.test(c)) || '';
      const nameGuess = cols.find((c) => /name|party|company|account/i.test(c)) || '';
      setIdCol(idGuess);
      setNameCol(nameGuess);
      toast.success(`Parsed ${result.total_rows} rows`, { description: 'Map columns below then click Import.' });
    } catch (err) {
      toast.error('Upload failed', { description: err.message });
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── Import accounts ──────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!nameCol) { toast.error('Select at least the Name column'); return; }
    setImporting(true);
    try {
      const res = await api.post('/excel/accounts/import', {
        rows: uploadResult.all_rows,
        mapping: { id_col: idCol, name_col: nameCol },
      });
      toast.success(`Imported ${res.data.imported} accounts`, {
        description: res.data.skipped ? `${res.data.skipped} rows skipped (empty name)` : undefined,
      });
      setUploadResult(null);
      loadAccounts();
    } catch (err) {
      toast.error('Import failed', { description: err.message });
    } finally {
      setImporting(false);
    }
  };

  // ── Create rule ──────────────────────────────────────────────────────────
  const handleCreateRule = async () => {
    if (!ruleName.trim()) { toast.error('Rule name is required'); return; }
    if (!ruleSubject.trim()) { toast.error('Subject template is required'); return; }
    setSavingRule(true);
    try {
      await api.post('/excel/rules', {
        name: ruleName,
        activity_type: ruleType,
        subject_template: ruleSubject,
        duration_minutes: parseInt(ruleDuration, 10),
        notes_template: ruleNotes,
        account_filter: ruleFilter,
      });
      toast.success('Rule created');
      setNewRuleOpen(false);
      setRuleName(''); setRuleSubject(''); setRuleNotes(''); setRuleFilter('all');
      loadRules();
    } catch (err) {
      toast.error('Failed to create rule', { description: err.message });
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    try {
      await api.delete(`/excel/rules/${ruleId}`);
      toast.success('Rule deleted');
      loadRules();
    } catch (err) {
      toast.error('Delete failed', { description: err.message });
    }
  };

  // ── Preview ──────────────────────────────────────────────────────────────
  const handlePreview = async (rule) => {
    setPreviewRule(rule);
    setPreviewRows([]);
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const res = await api.post(`/excel/rules/${rule.id}/preview`);
      const rows = res.data?.rows || [];
      setPreviewRows(rows);
      setSelectedIds(new Set(rows.map((r) => r.account_id || r.name)));
    } catch (err) {
      toast.error('Preview failed', { description: err.message });
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleRow = (key) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === previewRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(previewRows.map((r) => r.account_id || r.name)));
    }
  };

  // ── Execute ──────────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!previewRule || selectedIds.size === 0) return;
    setPreviewOpen(false);
    try {
      const accountIds = Array.from(selectedIds);
      const res = await api.post(`/excel/rules/${previewRule.id}/execute`, { account_ids: accountIds });
      const jobId = res.data?.job_id;
      setJobData({ id: jobId, total: selectedIds.size, done: 0, failed: 0, status: 'running', rows: [] });
      setJobOpen(true);
      pollRef.current = setInterval(async () => {
        try {
          const jr = await api.get(`/excel/jobs/${jobId}`);
          setJobData(jr.data);
          if (jr.data.status === 'complete') {
            clearInterval(pollRef.current);
            const { total, done, failed } = jr.data;
            if (failed === 0) toast.success(`All ${total} activities logged`);
            else toast.info(`${done} logged, ${failed} failed`);
          }
        } catch (_) {}
      }, 2000);
    } catch (err) {
      toast.error('Execution failed', { description: err.message });
    }
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  // ── Account search debounce ──────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => loadAccounts(accountSearch), 300);
    return () => clearTimeout(t);
  }, [accountSearch, loadAccounts]);

  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5] mb-1">Excel Automation</h1>
        <p className="text-[#9CA3AF] text-sm">Import accounts from Excel, create logging rules, and bulk-log activities to D365.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#1f2022] mb-6">
        <Tab label="Accounts" active={activeTab === 'accounts'} onClick={() => setActiveTab('accounts')} />
        <Tab label="Rules & Batch Run" active={activeTab === 'rules'} onClick={() => setActiveTab('rules')} />
      </div>

      {/* ── ACCOUNTS TAB ── */}
      {activeTab === 'accounts' && (
        <div className="space-y-6">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-none p-10 text-center cursor-pointer transition-colors ${
              dragging ? 'border-[#FF4500] bg-[#FF4500]/5' : 'border-[#1f2022] hover:border-[#FF4500]/40'
            }`}
          >
            <FileSpreadsheet className="w-8 h-8 text-[#9CA3AF] mx-auto mb-3" />
            <p className="text-[#F2F3F5] text-sm font-medium mb-1">Drop your .xlsx file here</p>
            <p className="text-[#9CA3AF] text-xs">or click to browse</p>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
          </div>

          {/* Column mapping */}
          {uploadResult && (
            <div className="bg-[#141416] border border-[#1f2022] p-5 space-y-4">
              <p className="text-[#F2F3F5] text-sm font-medium font-['Space_Grotesk']">
                Map Columns — {uploadResult.total_rows} rows detected
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">
                    Account ID Column <span className="text-[#9CA3AF]/50">(optional)</span>
                  </Label>
                  <Select value={idCol || '__none__'} onValueChange={(v) => setIdCol(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                      <SelectItem value="__none__" className="focus:bg-[#1f2022]">— None —</SelectItem>
                      {uploadResult.columns.map((c) => (
                        <SelectItem key={c} value={c} className="focus:bg-[#1f2022]">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">
                    Account Name Column <span className="text-[#ef4444]">*</span>
                  </Label>
                  <Select value={nameCol} onValueChange={setNameCol}>
                    <SelectTrigger className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                      {uploadResult.columns.map((c) => (
                        <SelectItem key={c} value={c} className="focus:bg-[#1f2022]">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Preview table */}
              <div className="border border-[#1f2022] overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#1f2022]">
                      {uploadResult.columns.map((c) => (
                        <th key={c} className="px-3 py-2 text-left text-[#9CA3AF] font-medium whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadResult.preview.map((row, i) => (
                      <tr key={i} className="border-b border-[#1f2022]/50 last:border-0">
                        {uploadResult.columns.map((c) => (
                          <td key={c} className="px-3 py-2 text-[#F2F3F5] max-w-[200px] truncate">{row[c] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleImport}
                  disabled={importing || !nameCol}
                  size="sm"
                  className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 text-xs px-4 transition-colors disabled:opacity-60"
                >
                  <Upload className="w-3 h-3 mr-1.5" />
                  {importing ? 'Importing…' : `Import ${uploadResult.total_rows} Accounts`}
                </Button>
                <Button
                  onClick={() => setUploadResult(null)}
                  variant="ghost"
                  size="sm"
                  className="text-[#9CA3AF] border border-[#1f2022] hover:bg-[#1f2022] rounded-none h-8 text-xs transition-colors"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Accounts table */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <p className="font-['Space_Grotesk'] text-sm font-semibold text-[#F2F3F5]">
                Imported Accounts
                {accounts.length > 0 && <span className="ml-2 text-[#9CA3AF] font-normal">({accounts.length})</span>}
              </p>
              <Input
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                placeholder="Search by name or ID…"
                className={`${INPUT_CLS} max-w-xs ml-auto`}
              />
            </div>
            {accountsLoading ? (
              <p className="text-[#9CA3AF] text-sm">Loading…</p>
            ) : accounts.length === 0 ? (
              <div className="bg-[#141416] border border-[#1f2022] p-8 text-center text-[#9CA3AF] text-sm">
                No accounts imported yet. Upload an Excel file above.
              </div>
            ) : (
              <div className="bg-[#141416] border border-[#1f2022] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1f2022]">
                      <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Account ID</th>
                      <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a, i) => (
                      <tr key={i} className="border-b border-[#1f2022] last:border-0">
                        <td className="px-4 py-2.5 text-[#9CA3AF] text-xs font-mono">{a.account_id || '—'}</td>
                        <td className="px-4 py-2.5 text-[#F2F3F5] text-sm">{a.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RULES TAB ── */}
      {activeTab === 'rules' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-[#9CA3AF] text-sm">Define a rule to bulk-log activities for all or selected accounts.</p>
            <Button
              onClick={() => setNewRuleOpen(true)}
              size="sm"
              className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 text-xs px-3 transition-colors"
            >
              <Plus className="w-3 h-3 mr-1.5" /> New Rule
            </Button>
          </div>

          {/* New rule inline form */}
          {newRuleOpen && (
            <div className="bg-[#141416] border border-[#FF4500]/30 p-5 space-y-4">
              <p className="text-[#F2F3F5] text-sm font-semibold font-['Space_Grotesk']">New Rule</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Rule Name <span className="text-[#ef4444]">*</span></Label>
                  <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="e.g. Q1 Follow-ups" className={INPUT_CLS} />
                </div>
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Activity Type</Label>
                  <Select value={ruleType} onValueChange={setRuleType}>
                    <SelectTrigger className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                      <SelectItem value="phonecall"   className="focus:bg-[#1f2022]">Phone Call</SelectItem>
                      <SelectItem value="task"        className="focus:bg-[#1f2022]">Task</SelectItem>
                      <SelectItem value="appointment" className="focus:bg-[#1f2022]">Meeting</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs text-[#9CA3AF] mb-1.5 block">
                  Subject Template <span className="text-[#ef4444]">*</span>
                  <span className="text-[#9CA3AF]/50 ml-2 normal-case">Use {'{name}'} for account name</span>
                </Label>
                <Input value={ruleSubject} onChange={(e) => setRuleSubject(e.target.value)} placeholder="e.g. Follow-up with {name}" className={INPUT_CLS} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Duration</Label>
                  <Select value={ruleDuration} onValueChange={setRuleDuration}>
                    <SelectTrigger className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                      {[15, 30, 45, 60, 90, 120].map((m) => (
                        <SelectItem key={m} value={String(m)} className="focus:bg-[#1f2022]">{m} min</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Target Accounts</Label>
                  <Select value={ruleFilter} onValueChange={setRuleFilter}>
                    <SelectTrigger className="bg-[#0f0f10] border-[#1f2022] text-[#F2F3F5] rounded-none h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#141416] border-[#1f2022] text-[#F2F3F5] rounded-none">
                      <SelectItem value="all" className="focus:bg-[#1f2022]">All imported accounts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs text-[#9CA3AF] mb-1.5 block">Notes Template <span className="text-[#9CA3AF]/50">(optional)</span></Label>
                <Input value={ruleNotes} onChange={(e) => setRuleNotes(e.target.value)} placeholder="e.g. Quarterly check-in with {name}" className={INPUT_CLS} />
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={handleCreateRule} disabled={savingRule} size="sm"
                  className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 text-xs px-4 transition-colors disabled:opacity-60">
                  {savingRule ? 'Saving…' : 'Save Rule'}
                </Button>
                <Button onClick={() => setNewRuleOpen(false)} variant="ghost" size="sm"
                  className="text-[#9CA3AF] border border-[#1f2022] hover:bg-[#1f2022] rounded-none h-8 text-xs transition-colors">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Rules list */}
          {rulesLoading ? (
            <p className="text-[#9CA3AF] text-sm">Loading…</p>
          ) : rules.length === 0 ? (
            <div className="bg-[#141416] border border-[#1f2022] p-8 text-center text-[#9CA3AF] text-sm">
              No rules yet. Create one above to bulk-log activities.
            </div>
          ) : (
            <div className="bg-[#141416] border border-[#1f2022] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1f2022]">
                    <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Rule</th>
                    <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden md:table-cell">Subject Template</th>
                    <th className="px-4 py-3 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-b border-[#1f2022] last:border-0">
                      <td className="px-4 py-3 text-[#F2F3F5] font-medium">{rule.name}</td>
                      <td className="px-4 py-3">
                        <Badge className="bg-[#1f2022] text-[#9CA3AF] border-[#1f2022] rounded-none text-[10px] hover:bg-[#1f2022]">
                          {ACTIVITY_LABELS[rule.activity_type] || rule.activity_type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-[#9CA3AF] text-xs hidden md:table-cell max-w-[220px] truncate">
                        {rule.subject_template}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handlePreview(rule)}
                            className="flex items-center gap-1 px-2 h-7 text-xs text-[#9CA3AF] border border-[#1f2022] hover:bg-[#1f2022] hover:text-[#F2F3F5] transition-colors"
                          >
                            <Eye className="w-3 h-3" /> Preview
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="flex items-center gap-1 px-2 h-7 text-xs text-[#ef4444]/70 border border-[#1f2022] hover:bg-[#ef4444]/10 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Preview Modal ── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="bg-[#141416] border border-[#1f2022] text-[#F2F3F5] max-w-[680px] rounded-none p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-[#1f2022]">
            <DialogTitle className="font-['Space_Grotesk'] text-base font-bold text-[#F2F3F5]">
              Preview — {previewRule?.name}
            </DialogTitle>
            <DialogDescription className="text-[#9CA3AF] text-sm">
              Uncheck accounts to exclude them. Then click Run.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 max-h-[50vh] overflow-y-auto">
            {previewLoading ? (
              <p className="text-[#9CA3AF] text-sm py-4">Loading accounts…</p>
            ) : previewRows.length === 0 ? (
              <p className="text-[#9CA3AF] text-sm py-4">No accounts match this rule. Import accounts first.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1f2022]">
                    <th className="pb-2 pr-3 w-8">
                      <button onClick={toggleAll} className="text-[#9CA3AF] hover:text-[#F2F3F5]">
                        {selectedIds.size === previewRows.length
                          ? <CheckSquare className="w-4 h-4 text-[#FF4500]" />
                          : <Square className="w-4 h-4" />}
                      </button>
                    </th>
                    <th className="pb-2 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Account</th>
                    <th className="pb-2 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider hidden sm:table-cell">Subject</th>
                    <th className="pb-2 text-left text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => {
                    const key = row.account_id || row.name;
                    const checked = selectedIds.has(key);
                    return (
                      <tr key={key} className={`border-b border-[#1f2022]/50 last:border-0 cursor-pointer ${!checked ? 'opacity-40' : ''}`}
                        onClick={() => toggleRow(key)}>
                        <td className="py-2.5 pr-3">
                          {checked
                            ? <CheckSquare className="w-4 h-4 text-[#FF4500]" />
                            : <Square className="w-4 h-4 text-[#9CA3AF]" />}
                        </td>
                        <td className="py-2.5 pr-3">
                          <p className="text-[#F2F3F5] text-xs font-medium">{row.name}</p>
                          {row.account_id && <p className="text-[#9CA3AF] text-[10px] font-mono">{row.account_id}</p>}
                        </td>
                        <td className="py-2.5 pr-3 text-[#9CA3AF] text-xs hidden sm:table-cell max-w-[200px] truncate">{row.subject}</td>
                        <td className="py-2.5">
                          <Badge className="bg-[#1f2022] text-[#9CA3AF] border-[#1f2022] rounded-none text-[10px] hover:bg-[#1f2022]">
                            {ACTIVITY_LABELS[row.activity_type] || row.activity_type}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-6 py-4 border-t border-[#1f2022] flex items-center justify-between">
            <p className="text-[#9CA3AF] text-xs">{selectedIds.size} of {previewRows.length} selected</p>
            <div className="flex gap-2">
              <Button onClick={() => setPreviewOpen(false)} variant="ghost" size="sm"
                className="text-[#9CA3AF] border border-[#1f2022] hover:bg-[#1f2022] rounded-none h-8 text-xs transition-colors">
                Cancel
              </Button>
              <Button onClick={handleRun} disabled={selectedIds.size === 0} size="sm"
                className="bg-[#FF4500] hover:bg-[#e63e00] text-white rounded-none h-8 text-xs px-4 transition-colors disabled:opacity-60">
                <Play className="w-3 h-3 mr-1.5" /> Run {selectedIds.size} Activities
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Job Progress Modal ── */}
      <Dialog open={jobOpen} onOpenChange={(o) => { if (!o) clearInterval(pollRef.current); setJobOpen(o); }}>
        <DialogContent className="bg-[#141416] border border-[#1f2022] text-[#F2F3F5] max-w-[620px] rounded-none p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-[#1f2022]">
            <DialogTitle className="font-['Space_Grotesk'] text-base font-bold text-[#F2F3F5]">
              Batch Execution
            </DialogTitle>
            {jobData && (
              <DialogDescription className="text-[#9CA3AF] text-sm">
                {jobData.status === 'complete'
                  ? `Complete — ${jobData.done} logged, ${jobData.failed} failed`
                  : `Running… ${jobData.done + jobData.failed} / ${jobData.total}`}
              </DialogDescription>
            )}
          </DialogHeader>

          {jobData && (
            <div className="px-6 py-4 space-y-4">
              {/* Progress bar */}
              <div className="w-full bg-[#1f2022] h-2">
                <div
                  className="bg-[#FF4500] h-2 transition-all duration-500"
                  style={{ width: `${jobData.total ? ((jobData.done + jobData.failed) / jobData.total) * 100 : 0}%` }}
                />
              </div>

              {/* Row list */}
              <div className="max-h-[45vh] overflow-y-auto space-y-1">
                {(jobData.rows || []).map((row, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-[#1f2022]/40 last:border-0">
                    <div>
                      <p className="text-[#F2F3F5] text-xs font-medium">{row.name}</p>
                      {row.account_id && <p className="text-[#9CA3AF] text-[10px] font-mono">{row.account_id}</p>}
                      {row.error && <p className="text-[#ef4444] text-[10px] mt-0.5">{row.error}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <StatusBadge status={row.status || 'pending'} />
                      {row.record_url && (
                        <a href={row.record_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                          className="text-[#FF4500] hover:underline">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {jobData.status === 'running' && (jobData.rows || []).length === 0 && (
                  <p className="text-[#9CA3AF] text-xs py-4">Starting…</p>
                )}
              </div>
            </div>
          )}

          <div className="px-6 py-4 border-t border-[#1f2022] flex justify-end">
            <Button onClick={() => { clearInterval(pollRef.current); setJobOpen(false); }} size="sm"
              className={`rounded-none h-8 text-xs px-4 transition-colors ${
                jobData?.status === 'complete'
                  ? 'bg-[#FF4500] hover:bg-[#e63e00] text-white'
                  : 'bg-transparent border border-[#1f2022] text-[#9CA3AF] hover:bg-[#1f2022]'
              }`}>
              {jobData?.status === 'complete' ? 'Done' : 'Close'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
