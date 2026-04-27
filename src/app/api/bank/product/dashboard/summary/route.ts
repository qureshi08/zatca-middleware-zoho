import { NextRequest, NextResponse } from 'next/server';
import { requireSession, getDashboardSummary } from '@/lib/bank/product-store';

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const summary = await getDashboardSummary(session.organization.id);
  return NextResponse.json(summary);
}
