'use client';

import { useApp } from '@/context/AppContext';
import { getOnboardingStatus } from '@/lib/zatca/onboarding-storage';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const router = useRouter();
  const { activeBank, apiKey, setApiKey, isLoading: contextLoading } = useApp();
  const [status, setStatus] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    if (!contextLoading && !activeBank) {
      router.push('/login');
    }

    if (!activeBank) return;

    // AUTO-PROVISION KEY FOR INSTITUTIONAL SYMMETRY
    if (!apiKey) {
      const stableKeySnippet = activeBank.id.replace(/-/g, '').slice(0, 32);
      setApiKey(`sk_zatca_live_${stableKeySnippet}`);
    }

    async function fetchData() {
      try {
        const [statRes, setupRes] = await Promise.all([
          fetch(`/api/v1/zatca/summary?period=month`, { headers: { 'x-api-key': apiKey || '' } }),
          getOnboardingStatus(activeBank?.id)
        ]);

        if (statRes.ok) {
          const statData = await statRes.json();
          if (statData.success) {
            setStats({
              ...statData.summary,
              recent: statData.recent
            });
          }
        }
        setStatus(setupRes);
      } catch (e) { }
    }

    fetchData();
  }, [activeBank]);

  if (contextLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!activeBank) {
    return (
      <div className="animate-pro section-pro">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center space-y-12">
            <div className="card-pro p-10 bg-white border-2 border-dashed border-gray-100 flex flex-col items-center">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-3xl mb-8">🏗️</div>
              <h1 className="h1 mb-2">Initialize Your Cluster</h1>
              <p className="body-text text-sm max-w-md mx-auto mb-8">Welcome to Z3C Nexus. Your regional node is active but no bank identities have been provisioned yet.</p>

              <Link href="/admin" className="btn-pro h-12 px-10 bg-blue-600 hover:scale-105 transition-transform shadow-2xl shadow-blue-500/20">
                Configure First Node
              </Link>

              <p className="text-[10px] text-gray-300 font-bold mt-8 uppercase tracking-widest italic">Setup requires your official Saudi Tax ID (TIN).</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="animate-pro section-pro">
        <div className="container">
          <div className="card-pro p-10 bg-amber-50 border-amber-100 text-center max-w-lg mx-auto">
            <h3 className="h3 mb-2 text-amber-700">Authorization Required</h3>
            <p className="small-text mb-6">This bank unit is not authorized on this device. Please enter your API Key in the sidebar to link the identity.</p>
            <Link href="/admin" className="btn-pro bg-amber-500">View Registry</Link>
          </div>
        </div>
      </div>
    );
  }

  const isLive = !!status?.productionCSID;
  const isCompliant = ['compliance_complete', 'production_received'].includes(status?.step);
  const hasCSR = !!status?.complianceCSID;

  return (
    <div className="animate-pro">
      <section className="section-pro border-b border-gray-100 bg-[#fbfbfd]">
        <div className="container">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="h1 mb-1">Control Center</h1>
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${isLive ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                  {isLive ? 'Live Hub' : 'Lab Mode'}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-gray-400">{activeBank.name} · Unit {activeBank.id}</span>
                  <div className="flex items-center gap-2 group">
                    <code className="text-[10px] bg-gray-100 px-2 py-0.5 rounded font-mono font-bold text-blue-600 cursor-pointer" onClick={() => navigator.clipboard.writeText(apiKey || '')}>
                      {apiKey}
                    </code>
                    <span className="text-[9px] font-black uppercase text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">Click to copy Key</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href="/explorer" className="btn-pro">
                Execute Transaction
              </Link>
              <Link href="/admin" className="btn-pro btn-pro-secondary">
                Registry
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section-pro">
        <div className="container">
          {/* Performance Data */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'INVOICES SUBMITTED', value: stats?.submittedCount || 0, color: 'text-blue-600' },
              { label: 'INVOICES PROCESSED', value: stats?.clearedCount || 0, color: 'text-green-600' },
              { label: 'CLEARANCE RATE', value: stats?.successRate || '0%', color: 'text-black' },
              { label: 'TOTAL FLOW', value: `SAR ${stats?.totalVolumeSAR || 0}`, color: 'text-purple-600' },
            ].map((stat, i) => (
              <div key={i} className="card-pro bg-white p-3 border border-gray-50 shadow-sm">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{stat.label}</span>
                <p className={`text-xl font-black tracking-tight mt-0.5 ${stat.color}`}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start mb-6">
            {/* Activation Progress (Smart Toggle) */}
            <div className="md:col-span-2 space-y-3">
              <h3 className="h3">{isLive ? 'Operational Context' : 'Activation Roadmap'}</h3>
              <div className="card-pro p-4 bg-[#fbfbfd]">
                {isLive ? (
                  <div className="flex items-center gap-4 py-1">
                    <div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-lg shadow-sm border border-green-200">✓</div>
                    <div>
                      <p className="text-[14px] font-black text-black">ZATCA Production Active</p>
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mt-1">Status: LIVE GATEWAY · Node 2.5</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between relative py-2">
                    <div className="absolute top-[16px] left-[20px] right-[20px] h-[2px] bg-gray-100 hidden md:block" />
                    <div
                      className="absolute top-[16px] left-[20px] h-[2px] bg-blue-600 transition-all duration-700 hidden md:block"
                      style={{ width: isCompliant ? '66%' : hasCSR ? '33%' : '0%' }}
                    />

                    {[
                      { label: 'CSR', done: hasCSR },
                      { label: 'Verification', done: isCompliant },
                      { label: 'ZATCA Live', done: isLive },
                    ].map((step, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center relative z-10">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 border-[#fff] transition-all duration-500 shadow-sm ${step.done ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400 text-xs'}`}>
                          {step.done ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          ) : (
                            <span className="font-black">{i + 1}</span>
                          )}
                        </div>
                        <span className={`mt-2 text-[11px] font-bold uppercase tracking-tight ${step.done ? 'text-black' : 'text-gray-400'}`}>{step.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Link href="/onboarding" className="card-pro flex items-center justify-between group hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 bg-black text-white rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">ID</div>
                    <div>
                      <p className="text-[13px] font-bold">Identity Suite</p>
                      <p className="text-[12px] text-gray-400">Complete e-invoicing setup</p>
                    </div>
                  </div>
                  <span className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </Link>
                <Link href="/explorer" className="card-pro flex items-center justify-between group hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">API</div>
                    <div>
                      <p className="text-[13px] font-bold">Activity Lab</p>
                      <p className="text-[12px] text-gray-400">Execute gateway requests</p>
                    </div>
                  </div>
                  <span className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </Link>
              </div>
            </div>

            {/* Entity Context (Dense) */}
            <div className="space-y-3">
              <h3 className="h3">Node Context</h3>
              <div className="card-pro p-3 bg-white space-y-2">
                <div className="flex justify-between items-center py-1 border-b border-gray-50">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Tax ID</span>
                  <span className="text-[13px] font-black">{activeBank.tax_number}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-gray-100">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Instances</span>
                  <span className="text-[13px] font-black">{status?.onboardedEgss?.length || 0}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-gray-50">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Network</span>
                  <span className="text-[13px] font-black text-blue-600 uppercase">SANDBOX_V2</span>
                </div>
                <div className="pt-2">
                  <p className="text-[11px] leading-relaxed text-gray-400 font-medium">Compliance signatures are refreshed every 30 days automatically by the middleware node.</p>
                </div>
              </div>

              <div className="card-pro bg-black p-4 text-white hover:bg-gray-900 cursor-pointer transition-colors group">
                <p className="text-[10px] uppercase font-bold text-gray-500 mb-1">Internal Support</p>
                <div className="flex justify-between items-center">
                  <span className="text-[13px] font-black group-hover:text-blue-400">Raise Technical Ticket</span>
                  <span className="text-gray-500 group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </div>
            </div>
          </div>

          {/* RECENT ACTIVITY LEDGER */}
          <div className="mt-6 space-y-3">
            <h3 className="h3">Audit Ledger (Recent Activity)</h3>
            <div className="card-pro bg-white overflow-hidden p-0 border border-gray-100">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#fbfbfd] border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-[11px] font-black uppercase tracking-widest text-gray-400">Reference No</th>
                    <th className="px-6 py-4 text-[11px] font-black uppercase tracking-widest text-gray-400">Timestamp</th>
                    <th className="px-6 py-4 text-[11px] font-black uppercase tracking-widest text-gray-400">Volume</th>
                    <th className="px-6 py-4 text-[11px] font-black uppercase tracking-widest text-gray-400">Status</th>
                    <th className="px-6 py-4 text-[11px] font-black uppercase tracking-widest text-gray-400 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(stats?.recent || []).map((row: any) => {
                    const displayTotal = row.total_amount || row.payload?.total || 0;
                    return (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 font-black text-[13px]">{row.invoice_number}</td>
                        <td className="px-6 py-4 text-[12px] text-gray-400 font-medium">
                          {new Date(row.created_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 font-bold text-[13px]">SAR {displayTotal}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${row.status === 'cleared' ? 'bg-green-100 text-green-700' :
                            row.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link href={`/api/v1/zatca/invoices/${row.id}/pdf`} title="Download PDF" className="text-gray-300 hover:text-blue-600 font-bold transition-colors">
                            PDF
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {(stats?.recent?.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-gray-300 italic text-[13px]">No transactions detected in recent registry.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}
