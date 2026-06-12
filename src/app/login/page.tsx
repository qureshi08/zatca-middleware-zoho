'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';

/**
 * INSTITUTIONAL LOGIN (v15.2 - CUSTOM GATEWAY)
 * Synchronized with the bank_users registry.
 */

import { Suspense } from 'react';

function LoginContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { setActiveBank, setApiKey } = useApp();
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        if (searchParams.get('registered')) {
            setSuccessMessage('Registration successful! Please sign in with your admin credentials.');
        }
    }, [searchParams]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const res = await fetch('/api/v1/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.details || 'Identity verification failed');
            }

            // 1. Success - Set global context
            setActiveBank(data.organization);
            if (data.apiKey) setApiKey(data.apiKey);

            // 2. Honor ?next= if present and safe (must be an internal absolute path).
            const requestedNext = searchParams.get('next');
            const safeNext =
                requestedNext &&
                requestedNext.startsWith('/') &&
                !requestedNext.startsWith('//')
                    ? requestedNext
                    : '/';
            router.push(safeNext);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full opacity-20">
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-600/20 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-600/20 rounded-full blur-[120px]" />
            </div>

            <div className="w-full max-w-md relative z-10">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-extrabold text-white tracking-tight mb-2">Gateway Sign In</h1>
                    <p className="text-gray-400 text-sm">Access your ZATCA e-invoicing middleware portal.</p>
                </div>

                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2rem] p-10 shadow-2xl">
                    <form onSubmit={handleLogin} className="space-y-6">
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold p-4 rounded-xl text-center uppercase tracking-widest">
                                {error}
                            </div>
                        )}

                        {successMessage && (
                            <div className="bg-green-500/10 border border-green-500/20 text-green-500 text-xs font-bold p-4 rounded-xl text-center">
                                {successMessage}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Admin Email</label>
                            <input
                                required
                                type="email"
                                placeholder="admin@mycompany.com"
                                className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-4 text-white text-sm focus:border-orange-500 outline-none transition-all"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1 px-1">Password</label>
                            <input
                                required
                                type="password"
                                placeholder="••••••••"
                                className="w-full h-12 bg-white/5 border border-white/10 rounded-xl px-4 text-white text-sm focus:border-orange-500 outline-none transition-all"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                            />
                        </div>

                        <button
                            disabled={loading}
                            className="w-full h-14 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-2xl shadow-xl shadow-orange-500/20 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                        >
                            {loading ? 'Authenticating...' : 'Sign In →'}
                        </button>
                    </form>

                    <p className="text-center text-gray-500 text-xs mt-8 font-medium">
                        Need a portal account? <Link href="/register?intent=zoho" className="text-orange-500 hover:underline">Register your business</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center text-white">Initializing Secure Gateway...</div>}>
            <LoginContent />
        </Suspense>
    );
}
