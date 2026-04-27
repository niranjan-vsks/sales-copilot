import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Trash2, Star, StarOff, FileSpreadsheet, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import api from '@/lib/api';

const CARD_VARIANTS = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export default function FileManagementPage() {
  const [files, setFiles]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [uploading, setUploading]       = useState(false);
  const [dragOver, setDragOver]         = useState(false);
  const [expandedFileId, setExpandedFileId] = useState(null);
  const [accountsState, setAccountsState]   = useState({});
  // accountsState: { [file_id]: { loading, accounts, q } }
  const fileInputRef = useRef(null);
  const searchTimers = useRef({});

  const loadFiles = () => {
    setLoading(true);
    api.get('/files/')
      .then((res) => {
        const list = Array.isArray(res?.data?.files) ? res.data.files : [];
        setFiles(list);
      })
      .catch((err) => toast.error('Failed to load files', { description: err?.message }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadFiles(); }, []);

  /* ── Upload ── */
  const uploadFile = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      toast.error('Unsupported file type', { description: 'Please upload an .xlsx or .csv file.' });
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL || ''}/api/files/upload-accounts`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
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

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  /* ── Set default ── */
  const setDefault = async (fileId) => {
    try {
      await api.post(`/files/${fileId}/set-default`);
      setFiles((prev) => prev.map((f) => ({ ...f, is_default: f.file_id === fileId })));
      toast.success('Default file updated');
    } catch {
      toast.error('Failed to update default');
    }
  };

  /* ── Delete ── */
  const deleteFile = async (fileId, filename) => {
    if (!window.confirm(`Delete "${filename}"? This also removes all imported accounts from this file.`)) return;
    try {
      await api.delete(`/files/${fileId}`);
      setFiles((prev) => prev.filter((f) => f.file_id !== fileId));
      if (expandedFileId === fileId) setExpandedFileId(null);
      toast.success('File deleted');
    } catch {
      toast.error('Failed to delete file');
    }
  };

  /* ── Expand / account preview ── */
  const fetchAccounts = useCallback(async (fileId, q = '') => {
    setAccountsState((prev) => ({
      ...prev,
      [fileId]: { ...prev[fileId], loading: true, q },
    }));
    try {
      const res = await api.get(`/files/${fileId}/accounts?q=${encodeURIComponent(q)}&limit=100`);
      setAccountsState((prev) => ({
        ...prev,
        [fileId]: { loading: false, accounts: res?.data?.accounts || [], q },
      }));
    } catch {
      setAccountsState((prev) => ({
        ...prev,
        [fileId]: { loading: false, accounts: [], q },
      }));
    }
  }, []);

  const toggleExpand = async (fileId) => {
    if (expandedFileId === fileId) {
      setExpandedFileId(null);
      return;
    }
    setExpandedFileId(fileId);
    if (!accountsState[fileId]) {
      await fetchAccounts(fileId, '');
    }
  };

  const handleAccountSearch = (fileId, q) => {
    setAccountsState((prev) => ({ ...prev, [fileId]: { ...prev[fileId], q } }));
    clearTimeout(searchTimers.current[fileId]);
    searchTimers.current[fileId] = setTimeout(() => fetchAccounts(fileId, q), 300);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <FileSpreadsheet className="w-5 h-5 text-[#FF4500]" />
          <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#F2F3F5]">File Management</h1>
        </div>
        <p className="text-[#9CA3AF] text-sm">
          Upload Excel or CSV files containing your account list. Set one as default to power account search in activity forms.
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileInput}
          />
          {uploading ? (
            <Loader2 className="w-8 h-8 text-[#FF4500] animate-spin" />
          ) : (
            <Upload className="w-8 h-8 text-[#9CA3AF]" />
          )}
          <div className="text-center">
            <p className="text-[#F2F3F5] text-sm font-medium">
              {uploading ? 'Uploading…' : 'Drop your file here or click to browse'}
            </p>
            <p className="text-[#9CA3AF] text-xs mt-1">.xlsx, .xls, .csv — your account list</p>
          </div>
        </div>
      </motion.div>

      {/* Column detection note */}
      <div className="mt-3 mb-6 flex items-start gap-2 text-xs text-[#9CA3AF]">
        <CheckCircle className="w-3.5 h-3.5 text-[#22c55e] shrink-0 mt-0.5" />
        <span>
          Columns are auto-detected: headers containing <strong className="text-[#F2F3F5]">IDG</strong> → MDM ID (IDG),{' '}
          <strong className="text-[#F2F3F5]">ISG</strong> → MDM ID (ISG),{' '}
          <strong className="text-[#F2F3F5]">party_name</strong> or <strong className="text-[#F2F3F5]">account name</strong> → account name.
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
                  <>
                    <tr
                      key={f.file_id}
                      className="border-b border-[#1f2022] hover:bg-[#1f2022]/30 cursor-pointer transition-colors"
                      onClick={() => toggleExpand(f.file_id)}
                    >
                      {/* Expand chevron */}
                      <td className="px-4 py-3 text-[#9CA3AF]">
                        {expandedFileId === f.file_id
                          ? <ChevronDown className="w-4 h-4" />
                          : <ChevronRight className="w-4 h-4" />
                        }
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
                        {f.is_default ? (
                          <Badge className="bg-[#FF4500]/10 text-[#FF4500] border-[#FF4500]/20 rounded-none text-[10px] px-2 py-0.5 hover:bg-[#FF4500]/10">
                            Default
                          </Badge>
                        ) : (
                          <span className="text-[#9CA3AF] text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {!f.is_default && (
                            <button
                              onClick={() => setDefault(f.file_id)}
                              title="Set as default"
                              className="w-7 h-7 flex items-center justify-center text-[#9CA3AF] hover:text-[#FF4500] transition-colors"
                            >
                              <StarOff className="w-4 h-4" />
                            </button>
                          )}
                          {f.is_default && (
                            <button
                              disabled
                              title="Default file"
                              className="w-7 h-7 flex items-center justify-center text-[#FF4500] opacity-60 cursor-default"
                            >
                              <Star className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteFile(f.file_id, f.filename)}
                            title="Delete file"
                            className="w-7 h-7 flex items-center justify-center text-[#9CA3AF] hover:text-[#ef4444] transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded account preview */}
                    <AnimatePresence>
                      {expandedFileId === f.file_id && (
                        <tr key={`${f.file_id}-expanded`} className="border-b border-[#1f2022]">
                          <td colSpan={6} className="px-4 pb-4 pt-0">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="bg-[#0f0f10] border border-[#1f2022] mt-2">
                                {/* Search bar */}
                                <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1f2022]">
                                  <Search className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
                                  <input
                                    type="text"
                                    placeholder="Search accounts in this file…"
                                    value={accountsState[f.file_id]?.q || ''}
                                    onChange={(e) => handleAccountSearch(f.file_id, e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="bg-transparent text-[#F2F3F5] text-xs outline-none flex-1 placeholder:text-[#9CA3AF]"
                                  />
                                  {accountsState[f.file_id]?.loading && (
                                    <Loader2 className="w-3.5 h-3.5 text-[#9CA3AF] animate-spin shrink-0" />
                                  )}
                                </div>

                                {/* Account rows */}
                                <div className="max-h-60 overflow-y-auto">
                                  {accountsState[f.file_id]?.loading && !accountsState[f.file_id]?.accounts?.length ? (
                                    <div className="flex justify-center py-6">
                                      <Loader2 className="w-4 h-4 animate-spin text-[#9CA3AF]" />
                                    </div>
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

                                {/* Footer count */}
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
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="mt-8 bg-[#141416] border border-[#1f2022] p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="w-4 h-4 text-[#9CA3AF]" />
          <p className="text-xs text-[#9CA3AF] font-medium uppercase tracking-wider">How account search works</p>
        </div>
        <ul className="space-y-1.5 text-xs text-[#9CA3AF]">
          <li>• Upload your account list — the file is parsed and stored in the database.</li>
          <li>• Set one file as <strong className="text-[#F2F3F5]">Default</strong> — it powers the account search in the activity log form.</li>
          <li>• Click any file row to expand and preview or search the accounts inside it.</li>
          <li>• When you type in the Account field on the dashboard, matching accounts from the default file are shown with their MDM IDs.</li>
          <li>• Selecting an account auto-fills the MDM ID field (read-only) on the form.</li>
        </ul>
      </div>
    </div>
  );
}
