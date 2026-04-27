import { NextRequest, NextResponse } from 'next/server';
import { requireSession, createInvoiceDraft, listInvoices } from '@/lib/bank/product-store';

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const invoices = await listInvoices(session.organization.id);
  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req, ['Admin', 'Maker']);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // Validate invoice fields
  if (!body.invoiceNumber || typeof body.invoiceNumber !== 'string' || body.invoiceNumber.trim().length === 0) {
    return NextResponse.json({ error: 'Invoice number is required' }, { status: 400 });
  }
  if (!body.customerId) {
    return NextResponse.json({ error: 'Customer selection is required' }, { status: 400 });
  }
  if (!['standard', 'simplified'].includes(body.type)) {
    return NextResponse.json({ error: 'Invoice type must be "standard" or "simplified"' }, { status: 400 });
  }
  if (!['388', '381', '383'].includes(body.documentType || '388')) {
    return NextResponse.json({ error: 'Document type must be 388, 381, or 383' }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 });
  }

  // Validate each item
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

  const result = await createInvoiceDraft(session.user, {
    invoiceNumber: body.invoiceNumber.trim(),
    customerId: body.customerId,
    type: body.type,
    documentType: body.documentType || '388',
    currency: body.currency || 'SAR',
    items: body.items.map((item: any) => ({
      name: item.name.trim(),
      quantity: Math.floor(item.quantity),
      unitPrice: Math.round(item.unitPrice * 100) / 100,
      vatRate: Math.round(item.vatRate * 100) / 100,
      vatCategory: item.vatCategory || 'S',
    })),
  });

  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
