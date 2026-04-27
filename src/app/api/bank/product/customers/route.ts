import { NextRequest, NextResponse } from 'next/server';
import { requireSession, listCustomers, createCustomer } from '@/lib/bank/product-store';

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const customers = await listCustomers(session.organization.id);
  return NextResponse.json({ customers });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req, ['Admin', 'Maker']);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // Validate required fields
  if (!body.customerCode || !body.registrationName) {
    return NextResponse.json({ error: 'Customer code and registration name are required' }, { status: 400 });
  }
  if (!body.vatNumber || !/^\d{15}$/.test(body.vatNumber)) {
    return NextResponse.json({ error: 'VAT number must be exactly 15 digits' }, { status: 400 });
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
  }
  if (body.phone && !/^\+?\d{7,15}$/.test(body.phone.replace(/\s/g, ''))) {
    return NextResponse.json({ error: 'Phone must be 7-15 digits (optional + prefix)' }, { status: 400 });
  }
  if (!body.address?.streetName || !body.address?.cityName || !body.address?.postalZone) {
    return NextResponse.json({ error: 'Street name, city name, and postal zone are required in address' }, { status: 400 });
  }
  if (body.address?.buildingNumber && !/^\d{1,10}$/.test(body.address.buildingNumber)) {
    return NextResponse.json({ error: 'Building number must be numeric (1-10 digits)' }, { status: 400 });
  }
  if (body.address?.postalZone && !/^\d{5}$/.test(body.address.postalZone)) {
    return NextResponse.json({ error: 'Postal zone must be exactly 5 digits' }, { status: 400 });
  }
  if (body.address?.country && !/^[A-Z]{2}$/.test(body.address.country)) {
    return NextResponse.json({ error: 'Country must be a 2-letter ISO code (e.g. SA)' }, { status: 400 });
  }

  const result = await createCustomer(session.user, {
    customerCode: body.customerCode,
    registrationName: body.registrationName,
    vatNumber: body.vatNumber,
    identificationScheme: body.identificationScheme || 'CRN',
    identificationNumber: body.identificationNumber || '',
    email: body.email || '',
    phone: body.phone || '',
    address: {
      streetName: body.address?.streetName || '',
      buildingNumber: body.address?.buildingNumber || '',
      citySubdivisionName: body.address?.citySubdivisionName || '',
      cityName: body.address?.cityName || '',
      postalZone: body.address?.postalZone || '',
      country: body.address?.country || 'SA',
    },
    status: 'active',
  });

  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
