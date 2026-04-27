import { NextRequest, NextResponse } from 'next/server';
import { requireSession, getIntegrationSettings, saveIntegrationSettings } from '@/lib/bank/product-store';

export async function GET(req: NextRequest) {
  const session = await requireSession(req, ['Admin']);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const integration = await getIntegrationSettings(session.organization.id);
  return NextResponse.json({ integration });
}

export async function PUT(req: NextRequest) {
  const session = await requireSession(req, ['Admin']);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { middlewareBaseUrl, middlewareApiKey, middlewareBankName } = body;
  if (!middlewareBaseUrl || !middlewareApiKey || !middlewareBankName) {
    return NextResponse.json(
      { error: 'middlewareBaseUrl, middlewareApiKey and middlewareBankName are required' },
      { status: 400 }
    );
  }

  let normalizedBaseUrl = '';
  try {
    normalizedBaseUrl = new URL(String(middlewareBaseUrl)).toString().replace(/\/$/, '');
  } catch {
    return NextResponse.json({ error: 'middlewareBaseUrl must be a valid URL' }, { status: 400 });
  }

  const result = await saveIntegrationSettings(session.user, {
    middlewareBaseUrl: normalizedBaseUrl,
    middlewareApiKey: String(middlewareApiKey),
    middlewareBankName: String(middlewareBankName),
  });
  if (!result.success) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  return NextResponse.json(result);
}
