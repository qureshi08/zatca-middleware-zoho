'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Settings, Link, CheckCircle2, XCircle, RefreshCw, LogOut, Info } from 'lucide-react';
import { useApp } from '@/context/AppContext';

function QuickbooksSettingsContent() {
  const router = useRouter();
  const { activeBank, isLoading: contextLoading } = useApp();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [realmId, setRealmId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const orgId = activeBank?.id ?? null;

  const searchParams = useSearchParams();
  const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Initial Load: Fetch existing config from DB for the active institutional node
  useEffect(() => {
    if (contextLoading) return;
    if (!activeBank) {
        router.push('/login');
        return;
    }

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/quickbooks/config?orgId=${activeBank.id}`);
            const data = await res.json();
            if (data.config) {
                setClientId(data.config.client_id || '');
                setClientSecret(data.config.client_secret || '');
                setRealmId(data.config.realm_id || '');
                setIsConnected(data.config.is_connected);
                setExpiresAt(data.config.token_expires_at);
            }
        } catch (e) {
            console.error('Failed to load config');
        } finally {
            setLoading(false);
        }
    };
    fetchConfig();

    // Check for success/error messages in URL from OAuth redirect
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    if (success) setMsg({ type: 'success', text: 'QuickBooks successfully connected!' });
    if (error) setMsg({ type: 'error', text: error });
  }, [contextLoading, activeBank, router, searchParams]);

  const saveConfig = async () => {
    if (!orgId) return;
    setLoading(true);
    try {
        const res = await fetch('/api/quickbooks/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgId, clientId, clientSecret, realmId })
        });
        if (!res.ok) throw new Error('Failed to save configuration');
        setMsg({ type: 'success', text: 'Configuration saved. You can now connect.' });
    } catch (e: any) {
        setMsg({ type: 'error', text: e.message });
    } finally {
        setLoading(false);
    }
  };

  const startOAuth = async () => {
    if (!clientId || !clientSecret) {
      setMsg({ type: 'error', text: 'Please enter Client ID and Secret first.' });
      return;
    }
    if (!orgId) {
      setMsg({ type: 'error', text: 'Organization context is missing. Please sign in again.' });
      return;
    }
    // Ensure config is saved first so the server has client_id/secret to use.
    await saveConfig();

    setLoading(true);
    try {
      const res = await fetch('/api/quickbooks/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Failed to initiate QuickBooks OAuth');
      }
      window.location.href = data.url;
    } catch (e: any) {
      setMsg({ type: 'error', text: e.message });
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <Settings className="text-blue-600" size={32} />
            Enterprise QuickBooks Integration
          </h1>
          <p className="text-slate-500 mt-2">Connect your QuickBooks Online account to synchronize invoices with ZATCA.</p>
        </div>
        {isConnected ? (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-full border border-green-200 font-medium">
            <CheckCircle2 size={18} />
            Connected
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-full border border-slate-200 font-medium">
            <XCircle size={18} />
            Disconnected
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Credentials Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <h2 className="text-xl font-semibold text-slate-800 flex items-center gap-2 border-b pb-4">
            <Link size={20} className="text-blue-500" />
            API Credentials
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client ID</label>
              <input
                type="text"
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="Enter Intuit Client ID"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client Secret</label>
              <input
                type="password"
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="Enter Intuit Client Secret"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Company Realm ID (Optional)</label>
              <input
                type="text"
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="Enter QuickBooks Realm ID"
                value={realmId}
                onChange={(e) => setRealmId(e.target.value)}
              />
              <p className="text-[10px] text-slate-400 mt-1">If left blank, it will be captured during connection.</p>
            </div>
          </div>

          <div className="pt-4 flex gap-3">
             <button
                onClick={saveConfig}
                disabled={loading}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold transition-all"
              >
                Save Draft
              </button>
              <button
                onClick={startOAuth}
                disabled={loading}
                className="flex-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
              >
                {loading ? <RefreshCw className="animate-spin" /> : <Link size={18} />}
                Connect & Authorize
              </button>
          </div>
        </div>

        {/* Status Card */}
        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <h2 className="text-xl font-semibold text-slate-800 flex items-center gap-2 border-b pb-4">
            <CheckCircle2 size={20} className="text-green-500" />
            Integration Status
          </h2>

          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-500">Connection</span>
              <span className={isConnected ? "text-green-600 font-medium" : "text-slate-400"}>
                {isConnected ? "Active" : "Not Configured"}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-500">Last Sync</span>
              <span className="text-slate-700 font-medium">
                {expiresAt ? new Date(expiresAt).toLocaleDateString() : 'Never'}
              </span>
            </div>
            <div className="bg-blue-100/50 p-3 rounded-xl flex gap-3">
                <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-800 leading-relaxed">
                    Once connected, the Middleware will automatically poll for new invoices every hour or receive them via Webhooks.
                </p>
            </div>
          </div>

          {msg && (
            <div className={`p-4 rounded-xl border ${
              msg.type === 'success' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'
            } flex items-start gap-3 animate-in slide-in-from-top-2 duration-300`}>
              {msg.type === 'success' ? <CheckCircle2 size={20} className="shrink-0" /> : <XCircle size={20} className="shrink-0" />}
              <p className="text-sm">{msg.text}</p>
            </div>
          )}
        </div>
      </div>

      {/* Guide Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-white">
        <h3 className="text-xl font-bold mb-4">How to Integrate</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold">1</div>
                <h4 className="font-semibold">Developer Portal</h4>
                <p className="text-[12px] text-slate-400">Create an app at developer.intuit.com and copy your Client Keys.</p>
            </div>
            <div className="space-y-2">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold">2</div>
                <h4 className="font-semibold">Whitelist URL</h4>
                <p className="text-[12px] text-slate-400">Add the Redirect URI to your Intuit App settings to allow the handshake.</p>
            </div>
            <div className="space-y-2">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold">3</div>
                <h4 className="font-semibold">Connect</h4>
                <p className="text-[12px] text-slate-400">Paste the keys here and click Connect. Your invoices will start syncing.</p>
            </div>
        </div>
      </div>
    </div>
  );
}

export default function QuickbooksSettings() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Loading settings...</div>}>
      <QuickbooksSettingsContent />
    </Suspense>
  );
}
