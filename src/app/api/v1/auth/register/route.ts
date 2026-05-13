import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { AuthService } from '@/lib/auth-service';
import crypto from 'node:crypto';

/**
 * INSTITUTIONAL AUTH GATEWAY (v14.3)
 * Custom Identity Engine - Bypasses internal Supabase Auth Database errors.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    console.log('[REGISTRATION-HUB]: Starting Custom Identity Provisioning');

    try {
        const body = await req.json();
        const { bankName, taxNumber, vatNumber, email, password } = body;

        // 1. Validation Shield
        if (!bankName || !taxNumber || !email || !password) {
            return NextResponse.json({ error: 'Incomplete Identity', details: 'All fields are required.' }, { status: 400 });
        }

        // 2. Supremacy Check
        const { data: existingOrg } = await supabaseAdmin
            .from('organizations')
            .select('id')
            .eq('tax_number', taxNumber)
            .maybeSingle();

        if (existingOrg) {
            return NextResponse.json({ error: 'Registration Conflict', details: 'This Tax ID (TIN) is already registered.' }, { status: 409 });
        }

        // 3. Provision the Institutional Entity
        const { data: org, error: orgError } = await supabaseAdmin
            .from('organizations')
            .insert({
                name: bankName,
                tax_number: taxNumber,
                vat_number: vatNumber || taxNumber,
                status: 'onboarding'
            })
            .select()
            .single();

        if (orgError) throw new Error(`Vault Insertion Failed: ${orgError.message}`);

        // 4. Provision the Admin (Custom bank_users table)
        // Note: Using SHA-256 for password hashing for this custom implementation
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

        const { error: userError } = await supabaseAdmin
            .from('bank_users')
            .insert({
                organization_id: org.id,
                email: email,
                password_hash: passwordHash,
                full_name: `${bankName} Administrator`,
                role: 'Admin',
                user_status: 'active',
                password_history: [passwordHash],
                password_changed_at: new Date().toISOString(),
                password_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            });

        if (userError) {
            // Rollback Org
            await supabaseAdmin.from('organizations').delete().eq('id', org.id);
            throw new Error(`Bank User Registry Failed: ${userError.message}. Did you run the SQL script?`);
        }

        // 5. Issue the Initial Master API Key
        const { rawKey } = await AuthService.generateAPIKey(org.id, 'Primary Master Key');

        return NextResponse.json({
            success: true,
            message: 'Institutional Identity Activated.',
            nodeRef: org.id,
            apiKey: rawKey
        });

    } catch (e: any) {
        console.error('[REGISTRATION-FATAL]:', e.message);
        return NextResponse.json({
            success: false,
            error: 'Institutional Onboarding Failure',
            details: e.message
        }, { status: 500 });
    }
}
