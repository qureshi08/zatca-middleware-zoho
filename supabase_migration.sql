-- Run this in your Supabase SQL Editor to add the missing columns

ALTER TABLE zatca_profiles
  ADD COLUMN IF NOT EXISTS onboarding_step TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS compliance_secret TEXT,
  ADD COLUMN IF NOT EXISTS production_secret TEXT;

-- Backfill existing rows that have a production_csid
UPDATE zatca_profiles
SET onboarding_step = 'production_received'
WHERE production_csid IS NOT NULL AND onboarding_step = 'none';

-- Backfill rows that have compliance_csid but no production_csid
UPDATE zatca_profiles
SET onboarding_step = 'compliance_requested'
WHERE compliance_csid IS NOT NULL AND production_csid IS NULL AND onboarding_step = 'none';

-- Zoho Books integration settings (replaces the previous Odoo integration table)
CREATE TABLE IF NOT EXISTS zoho_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
    zoho_region TEXT NOT NULL DEFAULT 'sa',
    zoho_org_id TEXT NOT NULL,
    zoho_client_id TEXT NOT NULL,
    zoho_client_secret TEXT NOT NULL,
    zoho_refresh_token TEXT NOT NULL,
    auto_submit BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_sync TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- If migrating from a previous Odoo deployment, drop the old table once data is no longer needed:
-- DROP TABLE IF EXISTS odoo_config;
