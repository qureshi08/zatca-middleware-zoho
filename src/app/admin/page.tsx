'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';

export default function AdminPage() {
    const router = useRouter();
    const { activeBank, isLoading: contextLoading } = useApp();
    const [name, setName] = useState('');
    const [taxNumber, setTaxNumber] = useState('');
    const [vatNumber, setVatNumber] = useState('');
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [banks, setBanks] = useState<any[]>([]);

    useEffect(() => {
        if (contextLoading) return;
        if (!activeBank) {
            router.push('/login');
            return;
        }
        fetchBanks();
    }, [contextLoading, activeBank, router]);

    const fetchBanks = async () => {
        try {
            const res = await fetch('/api/internal/banks');
            const data = await res.json();
            if (data.success) setBanks(data.banks);
        } catch (err) { }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setApiKey(null);

        try {
            const response = await fetch('/api/internal/banks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, taxNumber, vatNumber }),
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error);

            setApiKey(data.api_key);
            fetchBanks();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="animate-in">
            <section className="section">
                <div className="container">
                    <header className="mb-6">
                        <h4 className="text-blue-600 font-bold uppercase tracking-widest text-[10px] mb-2">Systems Management</h4>
                        <h1 className="h1">Bank Registry</h1>
                        <p className="body-text max-w-xl text-xs">Provision and manage institutional tax identities across the regional middleware stack.</p>
                    </header>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start mt-6">
                        <div className="card-pro p-6 bg-white shadow-sm">
                            <h2 className="h2 mb-2">Institutional Setup</h2>
                            <p className="small-text mb-6">Enter bank organization details and generate gateway access credentials.</p>

                            <form onSubmit={handleRegister} className="space-y-6">
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5 pl-1">Bank Name</label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            className="form-input"
                                            placeholder="Arab National Bank"
                                            required
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5 pl-1">Tax ID</label>
                                            <input
                                                type="text"
                                                value={taxNumber}
                                                onChange={(e) => setTaxNumber(e.target.value)}
                                                className="form-input"
                                                placeholder="1010000000"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5 pl-1">VAT Reg</label>
                                            <input
                                                type="text"
                                                value={vatNumber}
                                                onChange={(e) => setVatNumber(e.target.value)}
                                                className="form-input"
                                                placeholder="3123456789..."
                                                required
                                            />
                                        </div>
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="button w-full py-4 text-xs font-black uppercase tracking-[0.2em] shadow-xl shadow-blue-500/20"
                                >
                                    {loading ? 'Transmitting Identity...' : 'Generate New Credentials'}
                                </button>
                            </form>

                            {apiKey && (
                                <div className="mt-8 p-8 bg-blue-50 text-blue-800 rounded-[20px] animate-in shadow-inner relative border border-blue-100 flex flex-col items-center">
                                    <div className="flex items-center gap-2 mb-4">
                                        <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                                        <p className="text-[11px] font-black uppercase tracking-widest">Identity Accepted</p>
                                    </div>
                                    <div className="bg-white p-4 rounded-xl mb-4 relative border border-blue-100 shadow-md w-full">
                                        <code className="text-sm font-mono font-black break-all text-blue-900 block text-center select-all">{apiKey}</code>
                                    </div>
                                    <button
                                        onClick={() => navigator.clipboard.writeText(apiKey)}
                                        className="button w-full py-3 text-[10px] uppercase font-black tracking-widest bg-blue-600 border-none"
                                    >
                                        Copy Secret Key
                                    </button>
                                    <p className="small-text mt-4 text-center italic text-blue-600/60 leading-relaxed max-w-[300px]">
                                        Store this key securely. Cryptographic data masking prevents re-provisioning of this specific ID.
                                    </p>
                                </div>
                            )}

                            {error && (
                                <div className="mt-6 p-4 rounded-xl bg-red-50 border border-red-100 text-[11px] font-bold text-red-500 italic text-center">
                                    {error}
                                </div>
                            )}
                        </div>

                        {/* Registry View */}
                        <div className="space-y-6">
                            <h2 className="h2 mb-4">Platform Registry</h2>
                            <p className="small-text mb-10 text-gray-400">A managed audit journal of active bank identities currently connected to the Z3C Institutional Bridge.</p>

                            <div className="card bg-white border-none p-0 overflow-hidden shadow-2xl">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="bg-gray-50/50">
                                            <th>Bank Identity</th>
                                            <th>Tax Identifier</th>
                                            <th className="text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {banks.map(bank => (
                                            <tr key={bank.id} className="hover:bg-gray-50/30 transition-all">
                                                <td>
                                                    <p className="text-lg font-black text-black tracking-tighter">{bank.name}</p>
                                                    <code className="text-[10px] font-mono font-bold text-blue-600 uppercase mt-0.5 block">{bank.id}</code>
                                                </td>
                                                <td className="text-sm font-bold text-gray-400">{bank.tax_number}</td>
                                                <td className="text-right">
                                                    <Link href="/" className="text-[10px] font-black uppercase text-blue-600 hover:tracking-[0.1em] transition-all">Connect →</Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {banks.length === 0 && (
                                    <div className="p-20 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                                        No registry records found
                                    </div>
                                )}
                            </div>
                            <div className="p-6 bg-gray-50 rounded-2xl italic small-text text-gray-400 border border-gray-100">
                                This dashboard is restricted to internal operations and bank auditors. All access is logged and verified with HMAC signing.
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

