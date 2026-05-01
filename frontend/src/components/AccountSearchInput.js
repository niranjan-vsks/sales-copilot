import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Loader2 } from 'lucide-react';
import api from '@/lib/api';

/**
 * AccountSearchInput
 *
 * Props:
 *   value        — current account name string (controlled)
 *   onChange     — called with { name, mdm_id_idg, mdm_id_isg } when user selects
 *                  OR { name, mdm_id_idg: '', mdm_id_isg: '' } for freehand text
 *   placeholder  — input placeholder
 *   disabled     — boolean
 */
export default function AccountSearchInput({ value = '', onChange, placeholder = 'Search account…', disabled = false }) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  // Sync external value changes (e.g. form reset)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const search = useCallback(async (q) => {
    if (!q || q.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(`/accounts/search?q=${encodeURIComponent(q)}&limit=10`);
      const items = res?.data?.results || [];
      setResults(items);
      setOpen(items.length > 0);
    } catch {
      setResults([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (e) => {
    const q = e.target.value;
    setQuery(q);
    // Freehand: always notify parent with empty MDM IDs
    onChange?.({ name: q, mdm_id_idg: '', mdm_id_isg: '' });

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 300);
  };

  const handleSelect = (item) => {
    const name = item.account_name;
    setQuery(name);
    setOpen(false);
    setResults([]);
    onChange?.({
      name,
      mdm_id_idg: item.l2_mdm_id_idg || '',
      mdm_id_isg: item.l2_mdm_id_isg || '',
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        {loading
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] animate-spin" />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
        }
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full h-9 pl-9 pr-3 bg-[#0f0f10] border border-[#1f2022] text-[#F2F3F5] text-sm placeholder-[#9CA3AF] focus:outline-none focus:border-[#FF4500] transition-colors disabled:opacity-50"
        />
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-[#141416] border border-[#1f2022] shadow-lg max-h-52 overflow-y-auto">
          {results.map((item, i) => (
            <li
              key={i}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
              className="px-3 py-2 cursor-pointer hover:bg-[#1f2022] transition-colors"
            >
              <p className="text-sm text-[#F2F3F5] truncate">{item.account_name}</p>
              {item.l2_mdm_id_idg && (
                <p className="text-xs text-[#9CA3AF] truncate">IDG: {item.l2_mdm_id_idg}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && !loading && results.length === 0 && query.length >= 1 && (
        <div className="absolute z-50 w-full mt-1 bg-[#141416] border border-[#1f2022] px-3 py-2">
          <p className="text-xs text-[#9CA3AF]">No accounts found — will be logged without account link</p>
        </div>
      )}
    </div>
  );
}
