import crypto from 'node:crypto';

/**
 * Sign / verify the `state` parameter for the QuickBooks OAuth handshake.
 *
 * The state carries the orgId that initiated the connection so the callback
 * knows which row in quickbooks_config to update — without this, the
 * callback can't tell two simultaneous connection attempts apart.
 *
 * Signing also provides CSRF protection: an attacker can't forge a callback
 * URL that targets someone else's org without knowing the secret.
 */

function getStateSecret(): string {
    const secret = process.env.QB_OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) {
        throw new Error(
            'No OAuth state secret available: set QB_OAUTH_STATE_SECRET (preferred) or SUPABASE_SERVICE_ROLE_KEY on the deployment.'
        );
    }
    return secret;
}

function toBase64Url(s: string): string {
    return Buffer.from(s, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function fromBase64Url(s: string): string {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (padded.length % 4)) % 4;
    return Buffer.from(padded + '='.repeat(pad), 'base64').toString('utf8');
}

function sign(payload: string): string {
    return crypto.createHmac('sha256', getStateSecret()).update(payload).digest('hex');
}

export function signOauthState(orgId: string): string {
    const payload = {
        orgId,
        nonce: crypto.randomBytes(8).toString('hex'),
        ts: Date.now(),
    };
    const encoded = toBase64Url(JSON.stringify(payload));
    return `${encoded}.${sign(encoded)}`;
}

/** Returns null on any tampering, mismatched signature, or expiry. */
export function verifyOauthState(state: string): { orgId: string } | null {
    const parts = state.split('.');
    if (parts.length !== 2) return null;
    const [encoded, providedSignature] = parts;

    let expectedSignature: string;
    try {
        expectedSignature = sign(encoded);
    } catch {
        return null;
    }

    // Constant-time compare to avoid timing leaks
    const a = Buffer.from(providedSignature);
    const b = Buffer.from(expectedSignature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    try {
        const payload = JSON.parse(fromBase64Url(encoded));
        if (!payload?.orgId || typeof payload.orgId !== 'string') return null;
        // OAuth round-trips usually finish in seconds; reject anything > 10 min old.
        if (typeof payload.ts !== 'number' || Date.now() - payload.ts > 10 * 60 * 1000) return null;
        return { orgId: payload.orgId };
    } catch {
        return null;
    }
}
