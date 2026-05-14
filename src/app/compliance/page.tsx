'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { runComplianceChecks } from '@/lib/zatca/onboarding'; // We can reuse the action
import { getOnboardingStatus } from '@/lib/zatca/onboarding-storage';
import { useApp } from '@/context/AppContext';

export default function CompliancePage() {
    const router = useRouter();
    const { activeBank, isLoading: contextLoading } = useApp();
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<any[]>([]);
    const [status, setStatus] = useState<any>(null);

    useEffect(() => {
        if (contextLoading) return;
        if (!activeBank) {
            router.push('/login');
            return;
        }
        checkPrerequisites();
    }, [contextLoading, activeBank, router]);

    const checkPrerequisites = async () => {
        const s = await getOnboardingStatus();
        setStatus(s);
    };

    const runTests = async () => {
        setLoading(true);
        // We reuse the existing server action which runs the 6-doc suite
        const res = await runComplianceChecks('BOJ-ORG-1001');
        if (res.success && res.results) {
            setResults(res.results);
        } else {
            alert('Compliance check failed: ' + res.error);
        }
        setLoading(false);
    };

    if (!status) return <div className="p-8">Loading configuration...</div>;

    // Guard: Must have at least a Compliance CSID (Step 1 of onboarding complete)
    if (!status.complianceCSID) {
        return (
            <div style={{ minHeight: '100vh', background: 'var(--bg-main)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ maxWidth: '500px', textAlign: 'center', padding: '3rem' }}>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: '800', marginBottom: '1rem' }}>Configuration Required</h2>
                    <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>
                        You must complete the Digital Onboarding phase (CSR Generation & CCSID Acquisition) before running compliance tests.
                    </p>
                    <Link href="/onboarding" className="btn btn-primary">GO TO ONBOARDING</Link>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-main)' }}>
            <nav className="boj-nav">
                <div className="container" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Link href="/" className="btn btn-plain" style={{ padding: '0.3rem 0.6rem' }}>← HUB</Link>
                        <h2 style={{ fontSize: '11px', color: 'white' }}>ZATCA COMPLIANCE WORKFLOW</h2>
                    </div>
                </div>
            </nav>

            <main className="container" style={{ padding: '3rem 0' }}>
                <header style={{ marginBottom: '3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                        <h2 style={{ fontSize: '1.8rem', fontWeight: '800', marginBottom: '0.5rem' }}>Compliance <span style={{ color: 'var(--boj-red)' }}>Test Suite</span></h2>
                        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', maxWidth: '600px' }}>
                            Mandatory verification protocol for ZATCA Phase 2 (Integration).
                            Executes a 6-document sequence against the Fatoora Compliance API.
                        </p>
                    </div>
                    <div>
                        <div className="status-tag" style={{ background: '#334155', color: 'white' }}>
                            CSID: {status.complianceRequestId?.substring(0, 12)}...
                        </div>
                    </div>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem' }}>

                    {/* Main Test Runner Area */}
                    <div className="card">
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Standard Compliance Protocol</span>
                            {results.length > 0 && results.every(r => r.success) && (
                                <span className="status-tag status-active">ALL TESTS PASSED</span>
                            )}
                        </div>

                        <div style={{ padding: '2rem' }}>
                            {results.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                                    <div style={{ fontSize: '4rem', marginBottom: '1rem', opacity: 0.2 }}>🛡️</div>
                                    <h3 style={{ fontWeight: '800', marginBottom: '0.5rem' }}>Ready to Execute</h3>
                                    <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', maxWidth: '400px', margin: '0 auto 2rem' }}>
                                        This process will generate Standard and Simplified invoices, including Debit and Credit notes, sign them with your Compliance CSID, and submit them to ZATCA.
                                    </p>
                                    <button
                                        onClick={runTests}
                                        disabled={loading}
                                        className="btn btn-secondary"
                                        style={{ padding: '0.75rem 2rem', fontSize: '1rem' }}
                                    >
                                        {loading ? 'EXECUTING PROTOCOL...' : 'INITIATE COMPLIANCE CHECK'}
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                                                <th style={{ padding: '1rem', fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Document Type</th>
                                                <th style={{ padding: '1rem', fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Usage</th>
                                                <th style={{ padding: '1rem', fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>SHA-256 Hash</th>
                                                <th style={{ padding: '1rem', textAlign: 'right', fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {results.map((res, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={{ padding: '1rem', fontWeight: '700', fontSize: '11px' }}>
                                                        {res.type.toUpperCase().replace('_', ' ')}
                                                    </td>
                                                    <td style={{ padding: '1rem', fontSize: '11px', color: 'var(--text-dim)' }}>
                                                        {res.type.includes('standard') ? 'B2B Clearance' : 'B2C Reporting'}
                                                    </td>
                                                    <td style={{ padding: '1rem' }}>
                                                        <code style={{ fontSize: '9px', background: '#F1F5F9', padding: '2px 4px', borderRadius: '2px' }}>
                                                            {res.hash?.substring(0, 16)}...
                                                        </code>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                                                        {res.success ? (
                                                            <span style={{ color: '#007A33', fontWeight: '800', fontSize: '10px' }}>PASS ✓</span>
                                                        ) : (
                                                            <span style={{ color: '#B91C1C', fontWeight: '800', fontSize: '10px' }}>FAIL ✗</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    <div style={{ marginTop: '2rem', textAlign: 'right' }}>
                                        <button
                                            onClick={() => setResults([])}
                                            className="btn btn-plain"
                                            style={{ fontSize: '11px', marginRight: '1rem' }}
                                        >
                                            CLEAR RESULTS
                                        </button>
                                        <button
                                            onClick={runTests}
                                            disabled={loading}
                                            className="btn btn-secondary"
                                        >
                                            RE-RUN SUITE
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Side Panel */}
                    <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div className="card" style={{ padding: '1.5rem', borderTop: '3px solid var(--boj-gold)' }}>
                            <h4 className="text-xs" style={{ fontWeight: '800', marginBottom: '0.5rem' }}>NEXT STEPS</h4>
                            <p className="text-xs" style={{ color: 'var(--text-dim)', lineHeight: '1.5', marginBottom: '1rem' }}>
                                Upon successful completion of all compliance tests, your CSID is eligible for promotion to Production status.
                            </p>
                            {status.isRegistered ? (
                                <div className="status-tag status-active" style={{ textAlign: 'center', display: 'block' }}>ALREADY IN PRODUCTION</div>
                            ) : (
                                <Link href="/onboarding" className="btn btn-primary" style={{ width: '100%', textAlign: 'center' }}>
                                    REQUEST PRODUCTION CSID →
                                </Link>
                            )}
                        </div>

                        <div className="card" style={{ padding: '1.5rem' }}>
                            <h4 className="text-xs" style={{ fontWeight: '800', marginBottom: '0.5rem' }}>TECHNICAL NOTE</h4>
                            <p className="text-xs" style={{ color: 'var(--text-dim)', lineHeight: '1.5' }}>
                                Test results are ephemeral in the sandbox. Ensure all mandatory document types (Standard, Credit, Debit) are GREEN before proceeding.
                            </p>
                        </div>
                    </aside>

                </div>
            </main>
        </div>
    );
}
