'use client';

import { useEffect, useState } from 'react';
import { useBankAuthStore } from '@/store/bankAuthStore';
import { useRouter } from 'next/navigation';
import { Settings, Globe, Shield, Activity, HelpCircle, Save } from 'lucide-react';

export default function BankSettingsPage() {
  const router = useRouter();
  const { sessionToken, role, setIntegrationConfigured, logout } = useBankAuthStore();
  const [form, setForm] = useState({
    middlewareBaseUrl: 'https://zatca-universal-portal.vercel.app',
    middlewareApiKey: '',
    middlewareBankName: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionToken || role !== 'Admin') return;
    fetch('/api/bank/product/settings', { headers: { 'x-session-token': sessionToken } })
      .then(res => res.json())
      .then(data => {
        if (data.integration) setForm(data.integration);
      })
      .finally(() => setLoading(false));
  }, [sessionToken, role]);

  const onSave = async () => {
    if (!sessionToken) {
      setError('Your session has expired. Please sign in again.');
      return;
    }
    if (!form.middlewareBaseUrl.trim() || !form.middlewareApiKey.trim() || !form.middlewareBankName.trim()) {
      setError('Middleware URL, API key and Bank name are required.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/bank/product/settings', {
        method: 'PUT',
        headers: { 'x-session-token': sessionToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          router.push('/bank/login');
          throw new Error('Unauthorized session. Please sign in again.');
        }
        throw new Error(data?.error || 'Failed to save settings');
      }
      setIntegrationConfigured(!!form.middlewareApiKey);
      setSuccess('Middleware connectivity settings updated.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onTestConnection = async () => {
    if (!sessionToken) {
      setError('Your session has expired. Please sign in again.');
      return;
    }
    if (!form.middlewareBaseUrl.trim() || !form.middlewareApiKey.trim()) {
      setError('Middleware URL and API key are required to test connection.');
      return;
    }
    setTesting(true);
    setError(null);
    setSuccess(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/bank/product/settings/test', {
        method: 'POST',
        headers: { 'x-session-token': sessionToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          middlewareBaseUrl: form.middlewareBaseUrl.trim(),
          middlewareApiKey: form.middlewareApiKey.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          logout();
          router.push('/bank/login');
          setError('Unauthorized session. Please sign in again.');
          return;
        }
        setError(data?.error || 'Connection test failed.');
        return;
      }
      if (!data?.ok) {
        setTestResult(`Connection failed (${data?.status || 'N/A'}): ${data?.error || 'Unknown error'}`);
        return;
      }
      setTestResult(`Connected (${data?.status}). Organization: ${data?.organization || 'Detected'}`);
    } catch (e: any) {
      setError(e?.message || 'Connection test failed.');
    } finally {
      setTesting(false);
    }
  };

  if (role !== 'Admin') {
    return (
      <div className="p-20 text-center text-gray-400 font-bold uppercase tracking-widest text-[11px]">
        Access Denied. Contact Admin for portal configuration.
      </div>
    );
  }

  return (
    <div className="animate-pro max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="h1 flex items-center gap-2">
          <Settings size={28} className="text-blue-600" />
          Technical Configuration
        </h1>
        <p className="text-small">Configure how this bank portal communicates with the Z3C Compliance Middleware.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-8 space-y-6">
          <div className="card-pro p-6 bg-white border-blue-100 shadow-xl shadow-blue-900/5">
             <div className="flex items-center gap-2 mb-6 text-blue-600 border-b border-blue-50 pb-4">
                <Globe size={18} />
                <h3 className="text-[13px] font-black uppercase tracking-widest">Nexus Engine Connectivity</h3>
             </div>

             <div className="space-y-5">
                <div className="bank-form-group">
                  <label className="bank-form-label text-[10px] font-black uppercase">Internal Middleware Endpoint</label>
                  <input className="input-pro bg-gray-50/50" value={form.middlewareBaseUrl} onChange={e => setForm(f => ({ ...f, middlewareBaseUrl: e.target.value }))} placeholder="http://localhost:3000" />
                  <p className="text-[9px] text-gray-400 mt-1">Leave as localhost for the unified internal demo deployment.</p>
                </div>

                <div className="bank-form-group">
                  <label className="bank-form-label text-[10px] font-black uppercase">Branch Integration Key</label>
                  <div className="relative">
                    <Shield size={14} className="absolute left-3 top-2.5 text-blue-300" />
                    <input type="password" className="input-pro pl-9 bg-gray-50/50" value={form.middlewareApiKey} onChange={e => setForm(f => ({ ...f, middlewareApiKey: e.target.value }))} placeholder="sk_test_..." />
                  </div>
                  <p className="text-[9px] text-gray-400 mt-1">Obtain this key from the Middleware Admin Dashboard section.</p>
                </div>

                <div className="bank-form-group">
                  <label className="bank-form-label text-[10px] font-black uppercase">Registered Legal Entity Name</label>
                  <input className="input-pro bg-gray-50/50" value={form.middlewareBankName} onChange={e => setForm(f => ({ ...f, middlewareBankName: e.target.value }))} placeholder="e.g. Z3C National Bank" />
                </div>

                {error && <div className="bank-alert-error text-[11px] font-bold py-2">{error}</div>}
                {success && <div className="bank-alert-success text-[11px] font-bold py-2">{success}</div>}
                {testResult && <div className="bank-alert-success text-[11px] font-bold py-2">{testResult}</div>}

                <div className="pt-4 flex items-center gap-3">
                   <button
                     onClick={onTestConnection}
                     className="h-10 px-5 rounded-xl border border-gray-200 bg-white text-[11px] font-bold text-gray-700 hover:bg-gray-50 transition-all"
                     disabled={saving || testing}
                   >
                      {testing ? 'Testing...' : 'Test Connection'}
                   </button>
                   <button onClick={onSave} className="btn-pro h-10 px-8 flex items-center gap-2" disabled={saving || testing}>
                      <Save size={16} />
                      {saving ? 'Saving...' : 'Sync Configuration'}
                   </button>
                   <div className="flex items-center gap-1.5 text-[10px] font-black text-gray-400 uppercase tracking-widest px-3 border-l border-gray-100">
                      <Activity size={14} className="text-emerald-500" />
                      Status: {form.middlewareApiKey ? 'Connected' : 'Pending'}
                   </div>
                </div>
             </div>
          </div>
          
          <div className="flex items-start gap-4 p-5 rounded-2xl bg-amber-50 border border-amber-100">
             <HelpCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
             <div>
                <h4 className="text-[12px] font-black text-amber-900 uppercase">Self-Contained Mode</h4>
                <p className="text-[11px] text-amber-800 leading-relaxed mt-1">
                  In this unified deployment, the "Bank App" communicates via internal server-side calls to the middleware API. No external proxy is required.
                </p>
             </div>
          </div>
        </div>

        <div className="md:col-span-4 space-y-6">
           <div className="card-pro p-5 bg-gray-900 border-gray-800 text-white">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-blue-400 mb-4">Instance Secrets</h3>
              <div className="p-3 rounded-xl bg-gray-800/50 border border-gray-700/50 space-y-3 font-mono text-[9px]">
                 <div>
                    <span className="text-gray-500 text-[8px] uppercase block mb-0.5">Deployment ID</span>
                    <span className="text-blue-300">Z3C-NEX-0X-DEMO</span>
                 </div>
                 <div>
                    <span className="text-gray-500 text-[8px] uppercase block mb-0.5">Database Link</span>
                    <span className="text-emerald-300">BANKPROD_LOCAL_JSON</span>
                 </div>
                 <div>
                    <span className="text-gray-500 text-[8px] uppercase block mb-0.5">Token Policy</span>
                    <span className="text-amber-300">BEARER_PERSIST_PERSIST</span>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
