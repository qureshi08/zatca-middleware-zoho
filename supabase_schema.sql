-- ZATCA MIDDLEWARE MASTER DATABASE SCHEMA (Z3C v9.8)
-- Execute this in your new Supabase SQL Editor.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ORGANIZATIONS (Banks or Corporate Units)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    tax_number TEXT NOT NULL,
    vat_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'onboarding',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. ZATCA ONBOARDING PROFILES (CSID & Key Stores)
CREATE TABLE IF NOT EXISTS zatca_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
    onboarding_step TEXT NOT NULL DEFAULT 'none',
    compliance_request_id TEXT,
    compliance_csid TEXT,
    compliance_secret TEXT,
    production_csid TEXT,
    production_secret TEXT,
    private_key_base64 TEXT,
    public_key_base64 TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. API KEYS (High-privilege Node Access Tokens)
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT 'Default Key',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for fast authentication lookup
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash) WHERE status = 'active';

-- 4. INVOICES (Middleware Audit Ledger & Cache)
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    invoice_type TEXT NOT NULL,
    document_type TEXT NOT NULL DEFAULT '388', -- 388 = Invoice, 381 = Credit Note, 383 = Debit Note
    status TEXT NOT NULL DEFAULT 'draft',
    total_amount NUMERIC(18, 2),
    zatca_status TEXT, -- 'CLEARED' | 'REPORTED'
    zatca_uuid TEXT,
    qr_code TEXT,
    xml TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (organization_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_date ON invoices (organization_id, created_at DESC);

-- 5. TRANSACTION LOGS (Real-time Audit Trail)
CREATE TABLE IF NOT EXISTS transaction_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL, -- 'clearance' | 'reporting'
    invoice_number TEXT NOT NULL,
    invoice_hash TEXT,
    status TEXT NOT NULL, -- 'success' | 'failure'
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_logs_org_date ON transaction_logs (organization_id, created_at DESC);

-- 6. ZOHO BOOKS INTEGRATION SETTINGS
CREATE TABLE IF NOT EXISTS zoho_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
    zoho_region TEXT NOT NULL DEFAULT 'sa', -- Data-center suffix: sa | com | eu | in | com.au | jp | ca
    zoho_org_id TEXT NOT NULL,              -- Zoho Books organization_id
    zoho_client_id TEXT NOT NULL,           -- OAuth2 client id
    zoho_client_secret TEXT NOT NULL,       -- OAuth2 client secret
    zoho_refresh_token TEXT NOT NULL,       -- OAuth2 refresh token
    auto_submit BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_sync TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
