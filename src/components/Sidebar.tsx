'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useBankAuthStore } from '@/store/bankAuthStore';

const Icon = {
    grid: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
        </svg>
    ),
    shield: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
    ),
    key: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3m-3-3l-2.5-2.5" /></svg>
    ),
    list: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
    ),
};

export default function Sidebar({ mode: _unused }: { mode: string }) {
    const pathname = usePathname();
    const { activeBank, setActiveBank, apiKey, setApiKey } = useApp();
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 1. Sync User Session (Supabase fallback)
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(session.user);
            } else if (activeBank) {
                // INTERNAL SESSION DETECTED (via Context)
                setUser({
                    email: 'institutional-admin',
                    user_metadata: { organization_id: activeBank.id }
                } as any);

                // Auto-provision key if missing
                if (!apiKey) {
                    const stableKeySnippet = activeBank.id.replace(/-/g, '').slice(0, 32);
                    setApiKey(`sk_zatca_live_${stableKeySnippet}`);
                }
            }
            setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) setUser(session.user);
            else if (!activeBank) setUser(null);
        });

        return () => subscription.unsubscribe();
    }, [activeBank, setActiveBank, apiKey, setApiKey]);

    const handleLogout = async () => {
        // Clear AppContext (also clears z3c_active_bank / z3c_api_key from localStorage)
        setActiveBank(null);
        setApiKey(null);

        // Clear bank-side persisted session (zustand z3c-bank-demo-auth)
        try { useBankAuthStore.getState().logout(); } catch { }

        // Clear stray client-only invoice cache used by /invoices
        try { localStorage.removeItem('invoices'); } catch { }

        // Clear Supabase session if any
        try { await supabase.auth.signOut(); } catch { }

        // Drop synthesized user so UI flips to logged-out state before redirect
        setUser(null);

        window.location.href = '/login';
    };

    const isActive = (href: string) => {
        if (href === '/') return pathname === '/';
        return pathname.startsWith(href.split('?')[0]);
    };

    if (loading) return <aside className="sidebar p-8 text-xs font-bold text-gray-300">HUB_SYNC...</aside>;

    return (
        <aside className="sidebar shadow-2xl">
            <div className="mb-10 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="w-8 h-8 shrink-0 bg-orange-600 rounded-xl flex items-center justify-center text-[13px] text-white font-black shadow-lg shadow-orange-500/20">Z</div>
                    <div className="flex flex-col min-w-0 leading-tight">
                        <span className="text-[13px] font-extrabold tracking-tight text-black truncate">ZATCA</span>
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest truncate">Middleware</span>
                    </div>
                </div>
                {user && (
                    <button onClick={handleLogout} className="shrink-0 text-[9px] font-black text-gray-400 hover:text-red-500 transition-colors uppercase tracking-wide mt-1">Logout</button>
                )}
            </div>

            {user ? (
                <>
                    <div className="mb-8 p-4 bg-orange-50 rounded-2xl border border-orange-100">
                        <label className="text-[9px] font-black text-orange-400 uppercase tracking-widest mb-1 block">Active Integration</label>
                        <p className="text-[13px] font-bold text-gray-900 truncate">Zoho Books Connection</p>
                    </div>

                    <nav className="flex-1 space-y-6 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                        <div>
                            <div className="nav-label">Core Services</div>
                            <Link href="/" className={`nav-item${isActive('/') ? ' active' : ''}`}>{Icon.grid} Dashboard</Link>
                            <Link href="/admin/zoho/settings" className={`nav-item${isActive('/admin/zoho/settings') ? ' active' : ''}`}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 11 6a7 7 0 0 1 7 7M11 20a7 7 0 0 0 7-7M11 20l-4 4M18 13l4-4" /></svg>
                                Zoho Settings
                            </Link>
                        </div>

                        <div>
                            <div className="nav-label">ZATCA Configuration</div>
                            <Link href="/onboarding" className={`nav-item${isActive('/onboarding') ? ' active' : ''}`}>{Icon.key} ZATCA Onboarding</Link>
                        </div>

                        <div>
                            <div className="nav-label">Compliance Audits</div>
                            <Link href="/invoices" className={`nav-item${isActive('/invoices') ? ' active' : ''}`}>{Icon.list} Synced Invoices</Link>
                        </div>
                    </nav>
                </>
            ) : (
                <div className="flex-1 flex flex-col gap-5 pt-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
                    <div className="p-5 bg-orange-50 rounded-2xl border border-orange-100 text-center">
                        <h3 className="text-[12px] font-extrabold text-orange-800 mb-1.5 uppercase tracking-wider">Zoho ZATCA Gateway</h3>
                        <p className="text-[10px] text-orange-700/80 mb-4 leading-relaxed">Sign in or register your organization to link your Zoho Books account to the ZATCA e-invoicing service.</p>
                        <Link href="/login" className="block w-full h-9 bg-orange-600 text-white rounded-lg text-[11px] font-bold flex items-center justify-center hover:bg-orange-700 transition-all">Sign In</Link>
                        <Link href="/register?intent=zoho" className="block mt-2 text-[10px] text-orange-700 font-bold hover:underline">Register Business →</Link>
                    </div>
                </div>
            )}

            <div className="mt-auto pt-6 border-t border-gray-50">
                <div className="flex items-center gap-2 mb-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${user ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">System Status: {user ? 'Connected' : 'Standby'}</span>
                </div>
                <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest">Version 1.0.0 · Zoho Node</p>
            </div>
        </aside>
    );
}
