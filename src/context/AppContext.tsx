'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface Bank {
    id: string;
    name: string;
    tax_number: string;
    vat_number: string;
    api_key?: string;
    production_csid?: string;
}

interface AppContextType {
    activeBank: Bank | null;
    setActiveBank: (bank: Bank | null) => void;
    apiKey: string | null;
    setApiKey: (key: string | null) => void;
    isLoading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
    const [activeBank, setActiveBank] = useState<Bank | null>(null);
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Initial load from localStorage
    useEffect(() => {
        const savedKey = localStorage.getItem('z3c_api_key');
        const savedBank = localStorage.getItem('z3c_active_bank');

        if (savedKey) setApiKey(savedKey);
        if (savedBank) {
            try {
                setActiveBank(JSON.parse(savedBank));
            } catch (e) {
                console.error("Failed to parse saved bank", e);
            }
        }
        setIsLoading(false);
    }, []);

    // Sync to localStorage
    useEffect(() => {
        if (apiKey) localStorage.setItem('z3c_api_key', apiKey);
        else localStorage.removeItem('z3c_api_key');
    }, [apiKey]);

    useEffect(() => {
        if (activeBank) localStorage.setItem('z3c_active_bank', JSON.stringify(activeBank));
        else localStorage.removeItem('z3c_active_bank');
    }, [activeBank]);

    return (
        <AppContext.Provider value={{ activeBank, setActiveBank, apiKey, setApiKey, isLoading }}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
}
