'use client';

import { useApp } from '@/context/AppContext';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const REGIONS = [
    { value: 'sa', label: 'Saudi Arabia (.sa)' },
    { value: 'com', label: 'United States (.com)' },
    { value: 'eu', label: 'Europe (.eu)' },
    { value: 'in', label: 'India (.in)' },
    { value: 'com.au', label: 'Australia (.com.au)' },
    { value: 'jp', label: 'Japan (.jp)' },
    { value: 'ca', label: 'Canada (.ca)' },
];

export default function ZohoSettingsPage() {
    const { activeBank, apiKey } = useApp();
    const router = useRouter();

    const [zohoRegion, setZohoRegion] = useState('sa');
    const [zohoOrgId, setZohoOrgId] = useState('');
    const [zohoClientId, setZohoClientId] = useState('');
    const [zohoClientSecret, setZohoClientSecret] = useState('');
    const [zohoRefreshToken, setZohoRefreshToken] = useState('');
    const [autoSubmit, setAutoSubmit] = useState(true);

    const [status, setStatus] = useState<'connected' | 'disconnected' | 'saving' | 'testing' | 'provisioning'>('disconnected');
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
    const [provisionResults, setProvisionResults] = useState<{ created: string[]; errors: string[] } | null>(null);

    useEffect(() => {
        if (!activeBank) {
            router.push('/login');
            return;
        }

        async function fetchConfig() {
            try {
                const res = await fetch('/api/zoho/config', {
                    headers: { 'x-api-key': apiKey || '' }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.config) {
                        setZohoRegion(data.config.zoho_region || 'sa');
                        setZohoOrgId(data.config.zoho_org_id || '');
                        setZohoClientId(data.config.zoho_client_id || '');
                        setAutoSubmit(data.config.auto_submit ?? true);
                        setStatus(data.config.status || 'disconnected');
                    }
                }
            } catch (e) {
                console.error("Failed to load Zoho config", e);
            } finally {
                setLoading(false);
            }
        }

        fetchConfig();
    }, [activeBank, apiKey]);

    const handleAction = async (action: 'test' | 'save' | 'provision') => {
        setMessage(null);
        setProvisionResults(null);

        if (action === 'test') setStatus('testing');
        else if (action === 'provision') setStatus('provisioning');
        else setStatus('saving');

        try {
            const res = await fetch('/api/zoho/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey || ''
                },
                body: JSON.stringify({
                    zohoRegion,
                    zohoOrgId,
                    zohoClientId,
                    zohoClientSecret: zohoClientSecret || undefined,
                    zohoRefreshToken: zohoRefreshToken || undefined,
                    autoSubmit,
                    action
                })
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                setMessage({ type: 'error', text: data.error || 'Request failed' });
                if (action === 'provision' && data.errors) {
                    setProvisionResults({ created: data.created || [], errors: data.errors });
                }
                setStatus('disconnected');
            } else {
                setMessage({ type: 'success', text: data.message });
                if (action === 'provision') {
                    setProvisionResults({ created: data.created || [], errors: [] });
                }

                if (action === 'test' || action === 'provision' || data.status === 'saved_connected') {
                    setStatus('connected');
                } else {
                    setStatus('disconnected');
                }
            }
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Network error occurred' });
            setStatus('disconnected');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="w-5 h-5 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    const hostDomain = typeof window !== 'undefined' ? window.location.origin : 'https://your-middleware.com';

    return (
        <div className="animate-pro max-w-4xl mx-auto px-4 py-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div>
                    <h1 className="h1 flex items-center gap-2">
                        <span className="text-2xl">⚙️</span> Zoho Books Sync Configuration
                    </h1>
                    <p className="text-small text-gray-400 mt-1">
                        Connect your Zoho Books organization via OAuth2. Cleared signatures are pushed back to the invoice as comments, attachments and custom fields in real time.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                        status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                        {status === 'connected' ? 'Connected' : status === 'testing' ? 'Testing...' : status === 'provisioning' ? 'Checking...' : 'Disconnected'}
                    </span>
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Form Details */}
                <div className="md:col-span-2 space-y-4">
                    <div className="card-pro bg-white p-5 space-y-4 shadow-sm border-gray-100">
                        <h3 className="h3 text-gray-800">OAuth2 Connection Parameters</h3>

                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Data Center / Region</label>
                                    <select
                                        className="input-pro"
                                        value={zohoRegion}
                                        onChange={(e) => setZohoRegion(e.target.value)}
                                    >
                                        {REGIONS.map((r) => (
                                            <option key={r.value} value={r.value}>{r.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Organization ID</label>
                                    <input
                                        type="text"
                                        className="input-pro"
                                        placeholder="e.g. 60000000123"
                                        value={zohoOrgId}
                                        onChange={(e) => setZohoOrgId(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Client ID</label>
                                <input
                                    type="text"
                                    className="input-pro"
                                    placeholder="1000.XXXXXXXXXXXXXXXXXXXX"
                                    value={zohoClientId}
                                    onChange={(e) => setZohoClientId(e.target.value)}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Client Secret</label>
                                    <input
                                        type="password"
                                        className="input-pro"
                                        placeholder={zohoOrgId ? '•••••••••• (blank = keep current)' : 'OAuth Client Secret'}
                                        value={zohoClientSecret}
                                        onChange={(e) => setZohoClientSecret(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Refresh Token</label>
                                    <input
                                        type="password"
                                        className="input-pro"
                                        placeholder={zohoOrgId ? '•••••••••• (blank = keep current)' : 'OAuth Refresh Token'}
                                        value={zohoRefreshToken}
                                        onChange={(e) => setZohoRefreshToken(e.target.value)}
                                    />
                                </div>
                            </div>
                            <span className="text-[9px] text-gray-400 block">Generate these in the Zoho API Console (Self Client) with the <code>ZohoBooks.fullaccess.all</code> scope. Secrets are stored encrypted and never returned to the browser.</span>

                            <div className="flex items-center gap-2 pt-2">
                                <input
                                    type="checkbox"
                                    id="autoSubmit"
                                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                    checked={autoSubmit}
                                    onChange={(e) => setAutoSubmit(e.target.checked)}
                                />
                                <label htmlFor="autoSubmit" className="text-xs font-semibold text-gray-700">
                                    Enable Automated Webhook Writeback on Clearance
                                </label>
                            </div>
                        </div>

                        {message && (
                            <div className={`p-3 rounded-lg text-xs font-bold ${
                                message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                            }`}>
                                {message.text}
                            </div>
                        )}

                        {provisionResults && (
                            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-1">
                                <p className="font-bold text-gray-700">Custom Field Check:</p>
                                {provisionResults.created.length > 0 && (
                                    <p className="text-green-700">✓ Present: {provisionResults.created.join(', ')}</p>
                                )}
                                {provisionResults.errors.length > 0 && (
                                    <p className="text-red-700">❌ Missing: {provisionResults.errors.join(', ')}</p>
                                )}
                            </div>
                        )}

                        <div className="flex gap-2 pt-2 border-t border-gray-50">
                            <button
                                type="button"
                                className="btn-pro bg-orange-600 hover:bg-orange-700"
                                onClick={() => handleAction('save')}
                                disabled={status === 'saving' || status === 'testing' || status === 'provisioning'}
                            >
                                {status === 'saving' ? 'Saving...' : 'Save Settings'}
                            </button>
                            <button
                                type="button"
                                className="btn-pro btn-pro-secondary"
                                onClick={() => handleAction('test')}
                                disabled={status === 'saving' || status === 'testing' || status === 'provisioning'}
                            >
                                {status === 'testing' ? 'Verifying...' : 'Test Connection'}
                            </button>
                            <button
                                type="button"
                                className="btn-pro btn-pro-secondary text-orange-700 border-orange-100 hover:bg-orange-50"
                                onClick={() => handleAction('provision')}
                                disabled={status === 'saving' || status === 'testing' || status === 'provisioning'}
                            >
                                {status === 'provisioning' ? 'Checking...' : 'Verify Custom Fields'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Deployment Status side column */}
                <div className="space-y-4">
                    <div className="card-pro bg-gray-50 p-4 border-dashed border-gray-200">
                        <h4 className="text-[11px] font-black uppercase text-gray-400 tracking-wider mb-2">Sync Infrastructure</h4>
                        <div className="space-y-3 text-xs">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Connection:</span>
                                <span className={status === 'connected' ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                                    {status === 'connected' ? 'Active' : 'Offline'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">API:</span>
                                <span className="font-semibold text-gray-800">Zoho Books v3 (REST)</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Webhook Status:</span>
                                <span className="font-semibold text-orange-600">Active Listener</span>
                            </div>
                            <hr className="border-gray-200 my-2" />
                            <p className="text-[10px] text-gray-400 leading-relaxed font-medium">
                                Once OAuth parameters are verified, click <b>Verify Custom Fields</b> to confirm the ZATCA write-back fields exist in your Zoho Books invoice module.
                            </p>
                        </div>
                    </div>

                    <div className="card-pro bg-black text-white p-4">
                        <label className="text-[9px] font-black text-orange-400 uppercase tracking-widest block mb-1">Webhook URL</label>
                        <code className="text-[10px] font-mono select-all break-all block p-2 bg-gray-900 rounded border border-gray-800 text-orange-300">
                            {hostDomain}/api/zoho/webhook
                        </code>
                        <span className="text-[9px] text-gray-400 mt-2 block leading-snug">
                            Configure a Zoho Books workflow/webhook on "Invoice Created/Marked Sent" pointing to this URL.
                        </span>
                    </div>
                </div>
            </div>

            {/* Zoho Setup Instructions */}
            <div className="card-pro bg-white p-5 space-y-4 shadow-sm border-gray-100">
                <h3 className="h3 text-gray-800 flex items-center gap-2">
                    <span className="text-lg">⚡</span> Setup Playbook: Automating Zoho Books
                </h3>
                <p className="text-xs text-gray-500">
                    Zoho Books exposes a REST API and a Workflow Automation engine. No app install or self-hosting is required — generate OAuth credentials, create a few custom fields, then wire a webhook.
                </p>

                <div className="space-y-3">
                    <div className="text-xs space-y-1">
                        <p className="font-bold text-gray-700">Step 1: Generate OAuth credentials</p>
                        <p className="text-gray-500">In the <b>Zoho API Console</b> (<code>api-console.zoho.{zohoRegion}</code>) create a <b>Self Client</b> application:</p>
                        <ul className="list-disc pl-5 text-[11px] text-gray-500 space-y-0.5 mt-1">
                            <li>Copy the <code>Client ID</code> and <code>Client Secret</code>.</li>
                            <li>Generate a grant token with scope <code>ZohoBooks.fullaccess.all</code>.</li>
                            <li>Exchange the grant token for a <b>refresh token</b> and paste it above.</li>
                            <li>Find your <code>organization_id</code> under Zoho Books › Settings › Organizations.</li>
                        </ul>
                    </div>

                    <div className="text-xs space-y-1">
                        <p className="font-bold text-gray-700">Step 2: Create invoice custom fields</p>
                        <p className="text-gray-500">In Zoho Books › Settings › Preferences › Invoices › <b>Field Customization</b>, add these text fields so clearance results write back:</p>
                        <ul className="list-disc pl-5 text-[11px] text-gray-500 space-y-0.5 mt-1">
                            <li><code>cf_zatca_uuid</code> (Text)</li>
                            <li><code>cf_zatca_status</code> (Text / Dropdown: pending, submitted, cleared, failed)</li>
                            <li><code>cf_zatca_qr_code</code> (Multi-line Text)</li>
                            <li><code>cf_zatca_error</code> (Multi-line Text)</li>
                        </ul>
                        <p className="text-gray-400 text-[10px] mt-1">Optional: add <code>cf_zatca_document_type</code> to force a Debit Note (383) on a regular invoice.</p>
                    </div>

                    <div className="text-xs space-y-1">
                        <p className="font-bold text-gray-700">Step 3: Create the webhook (custom function)</p>
                        <p className="text-gray-500">Go to Zoho Books <b>Settings › Automation › Workflow Rules</b>, add a rule on <b>Invoices</b> triggered when an invoice is created or marked as sent, with a <b>Webhook</b> action:</p>
                        <ul className="list-disc pl-5 text-[11px] text-gray-500 space-y-0.5 mt-1">
                            <li><b>URL:</b> <code>{hostDomain}/api/zoho/webhook</code></li>
                            <li><b>Method:</b> <code>POST</code></li>
                            <li><b>Header:</b> <code>x-api-key: {apiKey || 'YOUR_API_KEY_HERE'}</code></li>
                        </ul>
                    </div>

                    <div>
                        <p className="font-bold text-gray-700 text-xs mb-1">Step 4: Webhook JSON body (pull mode)</p>
                        <pre className="p-3 bg-gray-950 text-green-400 font-mono text-[11px] rounded-lg overflow-x-auto leading-relaxed border border-gray-900 max-h-72">
{`{
  "action": "pull",
  "zohoInvoiceId": "\${invoice.invoice_id}",
  "entityType": "invoice"
}

// For credit notes, trigger a rule on the Credit Notes module:
{
  "action": "pull",
  "zohoInvoiceId": "\${creditnote.creditnote_id}",
  "entityType": "creditnote"
}`}
                        </pre>
                        <p className="text-gray-400 text-[10px] mt-1">The middleware pulls the document from Zoho, clears/reports it with ZATCA, then writes the UUID, QR and signed PDF back to the record.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
