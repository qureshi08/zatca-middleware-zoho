'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';

function getDocType(inv: any): { label: string; pillClass: string } {
    if (inv.documentType === '381' || inv.xml?.includes('InvoiceTypeCode>381'))
        return { label: 'Credit Note', pillClass: 'pill-error' };
    if (inv.documentType === '383' || inv.xml?.includes('InvoiceTypeCode>383'))
        return { label: 'Debit Note', pillClass: 'pill-info' };
    return { label: 'Tax Invoice', pillClass: 'pill-neutral' };
}

function getStatus(inv: any): { label: string; pillClass: string } {
    const s = inv.zatcaStatus;
    if (s === 'CLEARED' || s === 'REPORTED') return { label: s, pillClass: 'pill-success' };
    if (s === 'WARNING') return { label: 'WARNING', pillClass: 'pill-warning' };
    if (s === 'REJECTED') return { label: 'REJECTED', pillClass: 'pill-error' };
    return { label: 'PENDING', pillClass: 'pill-neutral' };
}

export default function InvoicesPage() {
    const router = useRouter();
    const { activeBank, isLoading: contextLoading } = useApp();
    const [invoices, setInvoices] = useState<any[]>([]);
    const [filter, setFilter] = useState('ALL');
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (contextLoading) return;
        if (!activeBank) {
            router.push('/login');
            return;
        }
        const stored = JSON.parse(localStorage.getItem('invoices') || '[]');
        setInvoices(stored.reverse());
    }, [contextLoading, activeBank, router]);

    const filtered = invoices
        .filter(inv => {
            if (filter === 'ALL') return true;
            if (filter === 'CLEARED') return ['CLEARED', 'REPORTED', 'WARNING'].includes(inv.zatcaStatus);
            if (filter === 'REJECTED') return inv.zatcaStatus === 'REJECTED';
            if (filter === 'PENDING') return !inv.zatcaStatus || inv.zatcaStatus === 'PENDING';
            if (filter === 'CREDIT') return inv.documentType === '381' || inv.xml?.includes('InvoiceTypeCode>381');
            if (filter === 'DEBIT') return inv.documentType === '383' || inv.xml?.includes('InvoiceTypeCode>383');
            return true;
        })
        .filter(inv =>
            !search || inv.id?.toLowerCase().includes(search.toLowerCase()) ||
            inv.buyer?.toLowerCase().includes(search.toLowerCase())
        );

    const stats = {
        total: invoices.length,
        cleared: invoices.filter(i => ['CLEARED', 'REPORTED', 'WARNING'].includes(i.zatcaStatus)).length,
        rejected: invoices.filter(i => i.zatcaStatus === 'REJECTED').length,
        pending: invoices.filter(i => !i.zatcaStatus || i.zatcaStatus === 'PENDING').length,
    };

    return (
        <div className="page-content animate-in">

            {/* Page Header */}
            <div className="section-header" style={{ marginBottom: '28px' }}>
                <div>
                    <h1 style={{ marginBottom: '6px' }}>Invoice Registry</h1>
                    <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
                        Audit trail of all ZATCA-submitted B2B tax instruments, credit and debit notes.
                    </p>
                </div>
                <Link href="/create" className="btn-primary">
                    + Create Invoice
                </Link>
            </div>

            {/* Stats Row */}
            <div className="grid-4" style={{ marginBottom: '24px' }}>
                {[
                    { label: 'Total', value: stats.total, pillClass: 'pill-neutral' },
                    { label: 'Cleared', value: stats.cleared, pillClass: 'pill-success' },
                    { label: 'Rejected', value: stats.rejected, pillClass: 'pill-error' },
                    { label: 'Pending', value: stats.pending, pillClass: 'pill-warning' },
                ].map(s => (
                    <div key={s.label} className="stat-card">
                        <div className="stat-label">{s.label}</div>
                        <div className="stat-value" style={{ fontSize: '28px' }}>{s.value}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                {['ALL', 'CLEARED', 'REJECTED', 'PENDING', 'CREDIT', 'DEBIT'].map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={filter === f ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                    >
                        {f}
                    </button>
                ))}
                <div style={{ marginLeft: 'auto' }}>
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by ID or Buyer..."
                        className="form-input"
                        style={{ width: '240px', fontSize: '12px', padding: '7px 12px' }}
                    />
                </div>
            </div>

            {/* Table */}
            <div className="card" style={{ overflow: 'hidden' }}>
                {filtered.length === 0 ? (
                    <div style={{ padding: '4rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '2rem', opacity: 0.15, marginBottom: '12px' }}>🧾</div>
                        <p style={{ color: 'var(--text-tertiary)', fontSize: '14px' }}>No invoices match your filter.</p>
                        {invoices.length === 0 && (
                            <Link href="/create" className="btn-primary btn-sm" style={{ marginTop: '16px', display: 'inline-flex' }}>
                                Create your first invoice
                            </Link>
                        )}
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Reference ID</th>
                                <th>Type</th>
                                <th>Date</th>
                                <th>Buyer</th>
                                <th style={{ textAlign: 'right' }}>Total (SAR)</th>
                                <th style={{ textAlign: 'right' }}>VAT (15%)</th>
                                <th style={{ textAlign: 'center' }}>ZATCA Status</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((inv) => {
                                const doc = getDocType(inv);
                                const status = getStatus(inv);
                                return (
                                    <tr key={inv.uuid}>
                                        <td>
                                            <Link href={`/invoices/${inv.uuid}`}
                                                style={{ color: '#93C5FD', fontWeight: 600, textDecoration: 'none', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>
                                                {inv.id}
                                            </Link>
                                        </td>
                                        <td>
                                            <span className={`pill ${doc.pillClass}`}>{doc.label}</span>
                                        </td>
                                        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>
                                            {inv.date || inv.issueDate}
                                        </td>
                                        <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                            {inv.buyer}
                                        </td>
                                        <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>
                                            {(Number(inv.total) || 0).toFixed(2)}
                                        </td>
                                        <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                            {(Number(inv.vatAmount) || 0).toFixed(2)}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span className={`pill ${status.pillClass}`}>{status.label}</span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <Link href={`/invoices/${inv.uuid}`} className="btn-ghost btn-sm">
                                                View →
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan={4} style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                                    {filtered.length} record{filtered.length !== 1 ? 's' : ''}
                                </td>
                                <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)', fontWeight: 700 }}>
                                    {filtered.reduce((s, i) => s + (Number(i.total) || 0), 0).toFixed(2)}
                                </td>
                                <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-tertiary)' }}>
                                    {filtered.reduce((s, i) => s + (Number(i.vatAmount) || 0), 0).toFixed(2)}
                                </td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    </table>
                )}
            </div>
        </div>
    );
}
