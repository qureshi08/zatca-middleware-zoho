import { NextRequest, NextResponse } from 'next/server';
import { requireSession, getInvoiceById, updateInvoiceDraft } from '@/lib/bank/product-store';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const invoice = await getInvoiceById(id, session.organization.id);
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  return NextResponse.json({ invoice });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req, ['Admin', 'Maker']);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // Validate items if provided
  if (body.items && Array.isArray(body.items)) {
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];
      if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) {
        return NextResponse.json({ error: `Item ${i + 1}: Name is required` }, { status: 400 });
      }
      if (typeof item.quantity !== 'number' || item.quantity < 1 || !Number.isInteger(item.quantity)) {
        return NextResponse.json({ error: `Item ${i + 1}: Quantity must be a positive whole number` }, { status: 400 });
      }
      if (typeof item.unitPrice !== 'number' || item.unitPrice < 0.01) {
        return NextResponse.json({ error: `Item ${i + 1}: Unit price must be at least 0.01` }, { status: 400 });
      }
      if (typeof item.vatRate !== 'number' || item.vatRate < 0 || item.vatRate > 100) {
        return NextResponse.json({ error: `Item ${i + 1}: VAT rate must be between 0 and 100` }, { status: 400 });
      }
    }
  }

  const result = await updateInvoiceDraft(session.user, id, body);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
