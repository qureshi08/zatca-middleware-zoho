import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/* ─── Types ─── */

export type Role = 'Admin' | 'Maker' | 'Checker' | 'Approver' | 'Auditor';
export type UserStatus = 'active' | 'locked';
export type CustomerStatus = 'active' | 'inactive';
export type InvoiceWorkflowStatus =
  | 'draft'
  | 'returned_by_checker'
  | 'submitted_for_check'
  | 'checked'
  | 'returned_by_approver'
  | 'approved_for_submission'
  | 'submitted_to_middleware'
  | 'cleared'
  | 'reported'
  | 'rejected'
  | 'failed_submission';

export interface ProductUser {
  id: string;
  organizationId?: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  passwordHash: string;
  passwordHistory: string[];
  passwordChangedAt: string;
  passwordExpiresAt: string;
  createdAt: string;
}

export interface ProductSession {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface Customer {
  id: string;
  customerCode: string;
  registrationName: string;
  vatNumber: string;
  identificationScheme: string;
  identificationNumber: string;
  email: string;
  phone: string;
  address: {
    streetName: string;
    buildingNumber: string;
    citySubdivisionName: string;
    cityName: string;
    postalZone: string;
    country: string;
  };
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceItemInput {
  name: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatCategory: 'S' | 'Z' | 'E' | 'O';
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  customerId: string;
  type: 'standard' | 'simplified';
  documentType: '388' | '381' | '383';
  status: InvoiceWorkflowStatus;
  totalAmount: number;
  vatAmount: number;
  currency: string;
  items: InvoiceItemInput[];
  customerSnapshot: Customer;
  createdByUserId: string;
  currentAssigneeRole: Role | null;
  middlewareInvoiceId?: string;
  middlewareUuid?: string;
  middlewareStatus?: string;
  invoiceHash?: string;
  qrCode?: string;
  signedXml?: string;
  validationMessages?: string[];
  lastComment?: string;
  workflowComments?: WorkflowComment[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowComment {
  id: string;
  invoiceId: string;
  byUserId: string;
  byRole: Role;
  byName: string;
  comment: string;
  createdAt: string;
}

export interface InvoiceWorkflowEvent {
  id: string;
  invoiceId: string;
  action: string;
  byUserId: string;
  byRole: Role;
  comment?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  category: 'auth' | 'customers' | 'invoices' | 'workflow' | 'integration' | 'cbs';
  action: string;
  actorUserId?: string;
  actorEmail?: string;
  targetId?: string;
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface IntegrationSettings {
  middlewareBaseUrl: string;
  middlewareApiKey: string;
  middlewareBankName: string;
}

export interface ProductState {
  organization: {
    id: string;
    name: string;
    passwordRotationDays: number;
  };
  users: ProductUser[];
  sessions: ProductSession[];
  customers: Customer[];
  invoices: InvoiceRecord[];
  invoiceWorkflowEvents: InvoiceWorkflowEvent[];
  auditLogs: AuditLog[];
  integration: IntegrationSettings;
}

/* ─── Helpers ─── */

function nowIso() {
  return new Date().toISOString();
}

function plusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function createId() {
  return crypto.randomUUID();
}

function hashPassword(password: string) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password: string, hash: string) {
  return hashPassword(password) === hash;
}

function getSessionSecret() {
  return (
    process.env.BANK_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'z3c-bank-demo-session-secret'
  );
}

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const missingPadding = padded.length % 4;
  const normalized = missingPadding ? padded + '='.repeat(4 - missingPadding) : padded;
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function signSessionPayload(encodedPayload: string) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createSignedSessionToken(user: ProductUser, expiresAt: string) {
  const payload = {
    sub: user.id,
    orgId: user.organizationId || null,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    exp: expiresAt,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signSessionPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function readSignedSessionToken(token: string) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = signSessionPayload(encodedPayload);
  if (providedSignature !== expectedSignature) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload));
    if (!parsed?.email || !parsed?.role || !parsed?.exp) return null;
    if (new Date(parsed.exp).getTime() <= Date.now()) return null;
    return parsed as {
      sub?: string;
      orgId?: string | null;
      email: string;
      role: Role;
      fullName?: string;
      exp: string;
    };
  } catch {
    return null;
  }
}

function getEmbeddedIntegrationConfig() {
  return {
    middlewareBaseUrl:
      process.env.EGS_MIDDLEWARE_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://zatca-universal-portal.vercel.app',
    middlewareApiKey: process.env.EGS_MIDDLEWARE_API_KEY || '',
    middlewareBankName: process.env.EGS_MIDDLEWARE_BANK_NAME || '',
  };
}

/* ─── Seed ─── */

function buildSeedState(): ProductState {
  const createdAt = nowIso();
  const rotationDays = 14;
  const defaultHash = hashPassword('ChangeMe123!');

  const makeUser = (fullName: string, email: string, role: Role): ProductUser => ({
    id: createId(),
    fullName,
    email,
    role,
    status: 'active',
    passwordHash: defaultHash,
    passwordHistory: [defaultHash],
    passwordChangedAt: createdAt,
    passwordExpiresAt: plusDays(rotationDays),
    createdAt,
  });

  const embedded = getEmbeddedIntegrationConfig();

  return {
    organization: {
      id: createId(),
      name: 'Z3C Bank Demo Tenant',
      passwordRotationDays: rotationDays,
    },
    users: [
      makeUser('Z3C Admin', 'admin@z3c.local', 'Admin'),
      makeUser('Invoice Maker', 'maker@z3c.local', 'Maker'),
      makeUser('Invoice Checker', 'checker@z3c.local', 'Checker'),
      makeUser('Invoice Approver', 'approver@z3c.local', 'Approver'),
      makeUser('Audit User', 'auditor@z3c.local', 'Auditor'),
    ],
    sessions: [],
    customers: [],
    invoices: [],
    invoiceWorkflowEvents: [],
    auditLogs: [
      {
        id: createId(),
        category: 'auth',
        action: 'seed_initialized',
        message: 'Bank product demo data initialized with default demo users.',
        createdAt,
      },
    ],
    integration: {
      middlewareBaseUrl: embedded.middlewareBaseUrl,
      middlewareApiKey: embedded.middlewareApiKey,
      middlewareBankName: embedded.middlewareBankName,
    },
  };
}

/* ─── In-Memory State (Vercel-compatible) ─── */
// Vercel serverless has a read-only filesystem. We use a global in-memory
// singleton instead. Data persists across warm invocations within the same
// instance, which is perfectly suited for a demo environment.

const globalStore = globalThis as unknown as { __bankProductState?: ProductState };

export async function readState(): Promise<ProductState> {
  if (!globalStore.__bankProductState) {
    globalStore.__bankProductState = buildSeedState();
  }
  return globalStore.__bankProductState;
}

async function writeState(next: ProductState) {
  globalStore.__bankProductState = next;
}

export async function mutateState<T>(fn: (state: ProductState) => T): Promise<T> {
  const state = await readState();
  const result = fn(state);
  await writeState(state);
  return result;
}

function pushAudit(
  state: ProductState,
  entry: Omit<AuditLog, 'id' | 'createdAt'>
) {
  state.auditLogs.unshift({
    id: createId(),
    createdAt: nowIso(),
    ...entry,
  });
}

/* ─── Auth ─── */

function createSessionForUser(state: ProductState, user: ProductUser) {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const session: ProductSession = {
    token: createSignedSessionToken(user, expiresAt),
    userId: user.id,
    createdAt: nowIso(),
    expiresAt,
  };
  state.sessions = state.sessions.filter((s) => s.userId !== user.id);
  state.sessions.unshift(session);
  return session;
}

export async function authenticateAndCreateSession(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = hashPassword(password);

  // Primary path: Supabase-backed bank user
  const { data: bankUser } = await supabaseAdmin
    .from('bank_users')
    .select('id, organization_id, full_name, email, password_hash, role, user_status, password_expires_at')
    .ilike('email', normalizedEmail)
    .maybeSingle();

  if (bankUser && bankUser.password_hash === passwordHash && (bankUser.user_status || 'active') === 'active') {
    const { data: organization } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', bankUser.organization_id)
      .maybeSingle();

    const { data: integration } = await supabaseAdmin
      .from('bank_integration_settings')
      .select('middleware_api_key')
      .eq('organization_id', bankUser.organization_id)
      .maybeSingle();

    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const user: ProductUser = {
      id: bankUser.id,
      organizationId: bankUser.organization_id,
      fullName: bankUser.full_name || bankUser.email,
      email: bankUser.email,
      role: (bankUser.role || 'Admin') as Role,
      status: 'active',
      passwordHash: bankUser.password_hash,
      passwordHistory: [],
      passwordChangedAt: nowIso(),
      passwordExpiresAt: bankUser.password_expires_at || expiresAt,
      createdAt: nowIso(),
    };

    const sessionToken = createSignedSessionToken(user, expiresAt);
    await supabaseAdmin.from('bank_sessions').insert({
      organization_id: bankUser.organization_id,
      user_id: bankUser.id,
      session_token: sessionToken,
      expires_at: expiresAt,
    });

    return {
      success: true as const,
      sessionToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        passwordExpiresAt: user.passwordExpiresAt,
      },
      organization: {
        id: organization?.id || bankUser.organization_id,
        name: organization?.name || 'Bank Organization',
        passwordRotationDays: 14,
      },
      integrationConfigured: !!integration?.middleware_api_key,
    };
  }

  // Fallback path: in-memory demo users
  return mutateState((state) => {
    const user = state.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) {
      return { success: false as const, error: 'Invalid credentials' };
    }

    const session = createSessionForUser(state, user);
    pushAudit(state, {
      category: 'auth',
      action: 'login_success',
      actorUserId: user.id,
      actorEmail: user.email,
      message: `${user.email} logged in`,
    });

    return {
      success: true as const,
      sessionToken: session.token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        passwordExpiresAt: user.passwordExpiresAt,
      },
      organization: state.organization,
      integrationConfigured: !!state.integration.middlewareApiKey,
    };
  });
}

export async function getSessionUser(sessionToken: string) {
  if (!sessionToken) return null;
  const state = await readState();

  // Backward compatibility for older in-memory-only sessions.
  const inMemorySession = state.sessions.find((s) => s.token === sessionToken && s.expiresAt > nowIso());
  if (inMemorySession) {
    const user = state.users.find((u) => u.id === inMemorySession.userId && u.status === 'active');
    if (user) return { user, organization: state.organization, integration: state.integration };
  }

  // Prefer stateless signed session tokens so auth survives serverless instance changes.
  const tokenPayload = readSignedSessionToken(sessionToken);
  if (!tokenPayload) return null;

  if (tokenPayload.orgId) {
    const { data: userRow } = await supabaseAdmin
      .from('bank_users')
      .select('id, organization_id, full_name, email, role, user_status, password_hash, password_expires_at, created_at')
      .eq('organization_id', tokenPayload.orgId)
      .eq('id', tokenPayload.sub || '')
      .maybeSingle();

    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('id, name')
      .eq('id', tokenPayload.orgId)
      .maybeSingle();

    const { data: integrationRow } = await supabaseAdmin
      .from('bank_integration_settings')
      .select('middleware_base_url, middleware_api_key, middleware_bank_name')
      .eq('organization_id', tokenPayload.orgId)
      .maybeSingle();

    if (userRow && (userRow.user_status || 'active') === 'active') {
      const dbUser: ProductUser = {
        id: userRow.id,
        organizationId: userRow.organization_id,
        fullName: userRow.full_name || userRow.email,
        email: userRow.email,
        role: (userRow.role || tokenPayload.role || 'Admin') as Role,
        status: 'active',
        passwordHash: userRow.password_hash || '',
        passwordHistory: [],
        passwordChangedAt: nowIso(),
        passwordExpiresAt: userRow.password_expires_at || tokenPayload.exp,
        createdAt: userRow.created_at || nowIso(),
      };

      return {
        user: dbUser,
        organization: {
          id: orgRow?.id || tokenPayload.orgId,
          name: orgRow?.name || 'Bank Organization',
          passwordRotationDays: 14,
        },
        integration: {
          middlewareBaseUrl: integrationRow?.middleware_base_url || getEmbeddedIntegrationConfig().middlewareBaseUrl,
          middlewareApiKey: integrationRow?.middleware_api_key || '',
          middlewareBankName: integrationRow?.middleware_bank_name || '',
        },
      };
    }
  }

  const resolvedUser =
    state.users.find((u) => u.id === tokenPayload.sub && u.status === 'active') ||
    state.users.find((u) => u.email.toLowerCase() === tokenPayload.email.toLowerCase() && u.status === 'active') ||
    ({
      id: tokenPayload.sub || createId(),
      fullName: tokenPayload.fullName || tokenPayload.email,
      email: tokenPayload.email,
      role: tokenPayload.role,
      status: 'active',
      passwordHash: '',
      passwordHistory: [],
      passwordChangedAt: nowIso(),
      passwordExpiresAt: tokenPayload.exp,
      createdAt: nowIso(),
    } satisfies ProductUser);

  return { user: resolvedUser, organization: state.organization, integration: state.integration };
}

export async function logoutSession(sessionToken: string) {
  await supabaseAdmin.from('bank_sessions').delete().eq('session_token', sessionToken);
  await mutateState((state) => {
    state.sessions = state.sessions.filter((s) => s.token !== sessionToken);
  });
}

export async function requireSession(req: NextRequest, roles?: Role[]) {
  const sessionToken = req.headers.get('x-session-token') || '';
  const session = await getSessionUser(sessionToken);
  if (!session) return null;
  if (roles && roles.length > 0 && !roles.includes(session.user.role)) return null;
  return session;
}

export async function changePassword(userId: string, currentPassword: string, nextPassword: string) {
  return mutateState((state) => {
    const user = state.users.find((u) => u.id === userId);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return { success: false as const, error: 'Current password is invalid' };
    }
    const nextHash = hashPassword(nextPassword);
    if (user.passwordHistory.includes(nextHash)) {
      return { success: false as const, error: 'New password must be different from recent passwords' };
    }
    user.passwordHash = nextHash;
    user.passwordHistory = [nextHash, ...user.passwordHistory].slice(0, 5);
    user.passwordChangedAt = nowIso();
    user.passwordExpiresAt = plusDays(state.organization.passwordRotationDays);
    pushAudit(state, {
      category: 'auth',
      action: 'password_changed',
      actorUserId: user.id,
      actorEmail: user.email,
      message: `${user.email} changed password`,
    });
    return { success: true as const };
  });
}

/* ─── Users ─── */

export async function listUsers() {
  const state = await readState();
  return state.users.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    status: u.status,
    passwordExpiresAt: u.passwordExpiresAt,
    createdAt: u.createdAt,
  }));
}

export async function createUser(
  actor: ProductUser,
  input: { fullName: string; email: string; role: Role; password: string }
) {
  return mutateState((state) => {
    if (state.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      return { success: false as const, error: 'User email already exists' };
    }
    const passwordHash = hashPassword(input.password);
    const user: ProductUser = {
      id: createId(),
      fullName: input.fullName,
      email: input.email,
      role: input.role,
      status: 'active',
      passwordHash,
      passwordHistory: [passwordHash],
      passwordChangedAt: nowIso(),
      passwordExpiresAt: plusDays(state.organization.passwordRotationDays),
      createdAt: nowIso(),
    };
    state.users.unshift(user);
    pushAudit(state, {
      category: 'auth',
      action: 'user_created',
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetId: user.id,
      message: `${actor.email} created user ${user.email}`,
    });
    return { success: true as const, user };
  });
}

/* ─── Integration Settings ─── */

export async function getIntegrationSettings(organizationId?: string) {
  if (organizationId) {
    const { data } = await supabaseAdmin
      .from('bank_integration_settings')
      .select('middleware_base_url, middleware_api_key, middleware_bank_name')
      .eq('organization_id', organizationId)
      .maybeSingle();
    const embedded = getEmbeddedIntegrationConfig();
    return {
      middlewareBaseUrl: data?.middleware_base_url || embedded.middlewareBaseUrl,
      middlewareApiKey: data?.middleware_api_key || embedded.middlewareApiKey,
      middlewareBankName: data?.middleware_bank_name || embedded.middlewareBankName,
    };
  }

  const state = await readState();
  const embedded = getEmbeddedIntegrationConfig();
  return {
    middlewareBaseUrl: state.integration.middlewareBaseUrl || embedded.middlewareBaseUrl,
    middlewareApiKey: state.integration.middlewareApiKey || embedded.middlewareApiKey,
    middlewareBankName: state.integration.middlewareBankName || embedded.middlewareBankName,
  };
}

export async function saveIntegrationSettings(
  actor: ProductUser,
  input: IntegrationSettings
) {
  if (actor.organizationId) {
    const { error } = await supabaseAdmin
      .from('bank_integration_settings')
      .upsert(
        {
          organization_id: actor.organizationId,
          middleware_base_url: input.middlewareBaseUrl,
          middleware_api_key: input.middlewareApiKey,
          middleware_bank_name: input.middlewareBankName,
        },
        { onConflict: 'organization_id' }
      );
    if (error) return { success: false as const, error: error.message };
    return { success: true as const, integration: input };
  }

  return mutateState((state) => {
    state.integration = input;
    pushAudit(state, {
      category: 'integration',
      action: 'middleware_configured',
      actorUserId: actor.id,
      actorEmail: actor.email,
      message: `${actor.email} updated middleware connection settings`,
      metadata: { middlewareBaseUrl: input.middlewareBaseUrl, middlewareBankName: input.middlewareBankName },
    });
    return { success: true as const, integration: state.integration };
  });
}

/* ─── Customers ─── */

export async function listCustomers(organizationId?: string) {
  if (organizationId) {
    const { data } = await supabaseAdmin
      .from('bank_customers')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    return (data || []).map((row: any) => ({
      id: row.id,
      customerCode: row.customer_code,
      registrationName: row.registration_name,
      vatNumber: row.vat_number,
      identificationScheme: row.identification_scheme,
      identificationNumber: row.identification_number,
      email: row.email || '',
      phone: row.phone || '',
      address: row.address || {},
      status: row.customer_status || 'active',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  const state = await readState();
  return state.customers;
}

export async function createCustomer(
  actor: ProductUser,
  input: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ success: true; customer: Customer } | { success: false; error: string }> {
  if (actor.organizationId) {
    const payload = {
      organization_id: actor.organizationId,
      customer_code: input.customerCode,
      registration_name: input.registrationName,
      vat_number: input.vatNumber,
      identification_scheme: input.identificationScheme,
      identification_number: input.identificationNumber,
      email: input.email,
      phone: input.phone,
      address: input.address,
      customer_status: input.status,
    };
    const { data, error } = await supabaseAdmin.from('bank_customers').insert(payload).select('*').single();
    if (error) return { success: false as const, error: error.message };
    return {
      success: true as const,
      customer: {
        id: data.id,
        customerCode: data.customer_code,
        registrationName: data.registration_name,
        vatNumber: data.vat_number,
        identificationScheme: data.identification_scheme,
        identificationNumber: data.identification_number,
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || {},
        status: data.customer_status || 'active',
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    };
  }

  return mutateState((state) => {
    if (state.customers.some(c => c.customerCode === input.customerCode)) {
      return { success: false as const, error: 'Customer code already exists' };
    }
    const customer: Customer = {
      id: createId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...input,
    };
    state.customers.unshift(customer);
    pushAudit(state, {
      category: 'customers',
      action: 'customer_created',
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetId: customer.id,
      message: `${actor.email} created customer ${customer.registrationName}`,
    });
    return { success: true as const, customer };
  });
}

/* ─── Invoices ─── */

function computeTotals(items: InvoiceItemInput[]) {
  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice * (1 + item.vatRate / 100), 0);
  const vatAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice * (item.vatRate / 100), 0);
  return {
    totalAmount: Number(totalAmount.toFixed(2)),
    vatAmount: Number(vatAmount.toFixed(2)),
  };
}

export async function listInvoices(organizationId?: string) {
  if (organizationId) {
    const { data } = await supabaseAdmin
      .from('bank_invoices')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    return (data || []).map((row: any) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      type: row.invoice_type,
      documentType: row.document_type,
      status: row.workflow_status,
      totalAmount: Number(row.total_amount || 0),
      vatAmount: Number(row.vat_amount || 0),
      currency: row.currency || 'SAR',
      items: row.items || [],
      customerSnapshot: row.customer_snapshot || {},
      createdByUserId: row.created_by_user_id,
      currentAssigneeRole: row.current_assignee_role,
      middlewareInvoiceId: row.middleware_invoice_id || undefined,
      middlewareUuid: row.middleware_uuid || undefined,
      middlewareStatus: row.middleware_status || undefined,
      invoiceHash: row.invoice_hash || undefined,
      qrCode: row.qr_code || undefined,
      signedXml: row.signed_xml || undefined,
      validationMessages: row.validation_messages || [],
      lastComment: row.last_comment || undefined,
      workflowComments: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  const state = await readState();
  return state.invoices;
}

export async function getInvoiceById(id: string, organizationId?: string) {
  if (organizationId) {
    const { data } = await supabaseAdmin
      .from('bank_invoices')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!data) return null;
    const { data: comments } = await supabaseAdmin
      .from('bank_invoice_comments')
      .select('*')
      .eq('invoice_id', id)
      .order('created_at', { ascending: true });
    return {
      id: data.id,
      invoiceNumber: data.invoice_number,
      customerId: data.customer_id,
      type: data.invoice_type,
      documentType: data.document_type,
      status: data.workflow_status,
      totalAmount: Number(data.total_amount || 0),
      vatAmount: Number(data.vat_amount || 0),
      currency: data.currency || 'SAR',
      items: data.items || [],
      customerSnapshot: data.customer_snapshot || {},
      createdByUserId: data.created_by_user_id,
      currentAssigneeRole: data.current_assignee_role,
      middlewareInvoiceId: data.middleware_invoice_id || undefined,
      middlewareUuid: data.middleware_uuid || undefined,
      middlewareStatus: data.middleware_status || undefined,
      invoiceHash: data.invoice_hash || undefined,
      qrCode: data.qr_code || undefined,
      signedXml: data.signed_xml || undefined,
      validationMessages: data.validation_messages || [],
      lastComment: data.last_comment || undefined,
      workflowComments: (comments || []).map((c: any) => ({
        id: c.id,
        invoiceId: c.invoice_id,
        byUserId: c.by_user_id,
        byRole: c.by_role,
        byName: c.by_name,
        comment: c.comment,
        createdAt: c.created_at,
      })),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  const state = await readState();
  return state.invoices.find((inv) => inv.id === id) || null;
}

export async function createInvoiceDraft(
  actor: ProductUser,
  input: {
    invoiceNumber: string;
    customerId: string;
    type: 'standard' | 'simplified';
    documentType: '388' | '381' | '383';
    currency: string;
    items: InvoiceItemInput[];
  }
) {
  if (actor.organizationId) {
    const { data: customerRow } = await supabaseAdmin
      .from('bank_customers')
      .select('*')
      .eq('id', input.customerId)
      .eq('organization_id', actor.organizationId)
      .eq('customer_status', 'active')
      .maybeSingle();
    if (!customerRow) return { success: false as const, error: 'Customer not found or inactive' };

    const { data: existingInvoice } = await supabaseAdmin
      .from('bank_invoices')
      .select('id')
      .eq('organization_id', actor.organizationId)
      .eq('invoice_number', input.invoiceNumber)
      .maybeSingle();
    if (existingInvoice) return { success: false as const, error: 'Invoice number already exists' };

    const totals = computeTotals(input.items);
    const customerSnapshot = {
      id: customerRow.id,
      customerCode: customerRow.customer_code,
      registrationName: customerRow.registration_name,
      vatNumber: customerRow.vat_number,
      identificationScheme: customerRow.identification_scheme,
      identificationNumber: customerRow.identification_number,
      email: customerRow.email || '',
      phone: customerRow.phone || '',
      address: customerRow.address || {},
      status: customerRow.customer_status || 'active',
      createdAt: customerRow.created_at,
      updatedAt: customerRow.updated_at,
    };

    const { data, error } = await supabaseAdmin
      .from('bank_invoices')
      .insert({
        organization_id: actor.organizationId,
        invoice_number: input.invoiceNumber,
        customer_id: input.customerId,
        invoice_type: input.type,
        document_type: input.documentType,
        workflow_status: 'draft',
        total_amount: totals.totalAmount,
        vat_amount: totals.vatAmount,
        currency: input.currency,
        items: input.items,
        customer_snapshot: customerSnapshot,
        created_by_user_id: actor.id,
        current_assignee_role: 'Maker',
      })
      .select('*')
      .single();
    if (error) return { success: false as const, error: error.message };
    return {
      success: true as const,
      invoice: {
        id: data.id,
        invoiceNumber: data.invoice_number,
        customerId: data.customer_id,
        type: data.invoice_type,
        documentType: data.document_type,
        status: data.workflow_status,
        totalAmount: Number(data.total_amount || 0),
        vatAmount: Number(data.vat_amount || 0),
        currency: data.currency || 'SAR',
        items: data.items || [],
        customerSnapshot: data.customer_snapshot || {},
        createdByUserId: data.created_by_user_id,
        currentAssigneeRole: data.current_assignee_role,
        workflowComments: [],
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    };
  }

  return mutateState((state) => {
    const customer = state.customers.find((c) => c.id === input.customerId && c.status === 'active');
    if (!customer) return { success: false as const, error: 'Customer not found or inactive' };
    if (state.invoices.some((inv) => inv.invoiceNumber === input.invoiceNumber)) {
      return { success: false as const, error: 'Invoice number already exists' };
    }
    const totals = computeTotals(input.items);
    const invoice: InvoiceRecord = {
      id: createId(),
      invoiceNumber: input.invoiceNumber,
      customerId: customer.id,
      type: input.type,
      documentType: input.documentType,
      status: 'draft',
      totalAmount: totals.totalAmount,
      vatAmount: totals.vatAmount,
      currency: input.currency,
      items: input.items,
      customerSnapshot: customer,
      createdByUserId: actor.id,
      currentAssigneeRole: 'Maker',
      workflowComments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    state.invoices.unshift(invoice);
    state.invoiceWorkflowEvents.unshift({
      id: createId(),
      invoiceId: invoice.id,
      action: 'draft_created',
      byUserId: actor.id,
      byRole: actor.role,
      createdAt: nowIso(),
    });
    pushAudit(state, {
      category: 'invoices',
      action: 'invoice_draft_created',
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetId: invoice.id,
      message: `${actor.email} created invoice draft ${invoice.invoiceNumber}`,
    });
    return { success: true as const, invoice };
  });
}

export async function updateInvoiceDraft(
  actor: ProductUser,
  invoiceId: string,
  input: {
    customerId?: string;
    type?: 'standard' | 'simplified';
    documentType?: '388' | '381' | '383';
    currency?: string;
    items?: InvoiceItemInput[];
  }
) {
  if (actor.organizationId) {
    const { data: invoice } = await supabaseAdmin
      .from('bank_invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('organization_id', actor.organizationId)
      .maybeSingle();
    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.created_by_user_id !== actor.id && actor.role !== 'Admin') {
      return { success: false as const, error: 'Only the creator or Admin can edit this invoice' };
    }
    if (!['draft', 'returned_by_checker', 'returned_by_approver'].includes(invoice.workflow_status)) {
      return { success: false as const, error: 'Only draft or returned invoices can be edited' };
    }

    let customerSnapshot = invoice.customer_snapshot;
    let customerId = invoice.customer_id;
    if (input.customerId) {
      const { data: customer } = await supabaseAdmin
        .from('bank_customers')
        .select('*')
        .eq('id', input.customerId)
        .eq('organization_id', actor.organizationId)
        .eq('customer_status', 'active')
        .maybeSingle();
      if (!customer) return { success: false as const, error: 'Customer not found or inactive' };
      customerId = customer.id;
      customerSnapshot = {
        id: customer.id,
        customerCode: customer.customer_code,
        registrationName: customer.registration_name,
        vatNumber: customer.vat_number,
        identificationScheme: customer.identification_scheme,
        identificationNumber: customer.identification_number,
        email: customer.email || '',
        phone: customer.phone || '',
        address: customer.address || {},
        status: customer.customer_status || 'active',
        createdAt: customer.created_at,
        updatedAt: customer.updated_at,
      };
    }

    const nextItems = input.items || invoice.items || [];
    const totals = computeTotals(nextItems);
    const updates: Record<string, unknown> = {
      customer_id: customerId,
      customer_snapshot: customerSnapshot,
      invoice_type: input.type || invoice.invoice_type,
      document_type: input.documentType || invoice.document_type,
      currency: input.currency || invoice.currency,
      items: nextItems,
      total_amount: totals.totalAmount,
      vat_amount: totals.vatAmount,
      updated_at: nowIso(),
    };

    const { data: updated, error } = await supabaseAdmin
      .from('bank_invoices')
      .update(updates)
      .eq('id', invoiceId)
      .eq('organization_id', actor.organizationId)
      .select('*')
      .single();
    if (error) return { success: false as const, error: error.message };
    return {
      success: true as const,
      invoice: {
        id: updated.id,
        invoiceNumber: updated.invoice_number,
        customerId: updated.customer_id,
        type: updated.invoice_type,
        documentType: updated.document_type,
        status: updated.workflow_status,
        totalAmount: Number(updated.total_amount || 0),
        vatAmount: Number(updated.vat_amount || 0),
        currency: updated.currency || 'SAR',
        items: updated.items || [],
        customerSnapshot: updated.customer_snapshot || {},
        createdByUserId: updated.created_by_user_id,
        currentAssigneeRole: updated.current_assignee_role,
        workflowComments: [],
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    };
  }

  return mutateState((state) => {
    const invoice = state.invoices.find((inv) => inv.id === invoiceId);
    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (invoice.createdByUserId !== actor.id && actor.role !== 'Admin') {
      return { success: false as const, error: 'Only the creator or Admin can edit this invoice' };
    }
    if (!['draft', 'returned_by_checker', 'returned_by_approver'].includes(invoice.status)) {
      return { success: false as const, error: 'Only draft or returned invoices can be edited' };
    }

    if (input.customerId) {
      const customer = state.customers.find((c) => c.id === input.customerId && c.status === 'active');
      if (!customer) return { success: false as const, error: 'Customer not found or inactive' };
      invoice.customerId = customer.id;
      invoice.customerSnapshot = customer;
    }
    if (input.type) invoice.type = input.type;
    if (input.documentType) invoice.documentType = input.documentType;
    if (input.currency) invoice.currency = input.currency;
    if (input.items) {
      invoice.items = input.items;
      const totals = computeTotals(input.items);
      invoice.totalAmount = totals.totalAmount;
      invoice.vatAmount = totals.vatAmount;
    }
    invoice.updatedAt = nowIso();

    state.invoiceWorkflowEvents.unshift({
      id: createId(),
      invoiceId: invoice.id,
      action: 'draft_updated',
      byUserId: actor.id,
      byRole: actor.role,
      createdAt: nowIso(),
    });
    pushAudit(state, {
      category: 'invoices',
      action: 'invoice_draft_updated',
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetId: invoice.id,
      message: `${actor.email} updated invoice draft ${invoice.invoiceNumber}`,
    });
    return { success: true as const, invoice };
  });
}

/* ─── Workflow Transitions ─── */

export async function transitionInvoice(
  actor: ProductUser,
  invoiceId: string,
  action:
    | 'submit_for_check'
    | 'checker_return'
    | 'checker_accept'
    | 'approver_return'
    | 'approver_approve',
  comment?: string
) {
  if (actor.organizationId) {
    const { data: invoice } = await supabaseAdmin
      .from('bank_invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('organization_id', actor.organizationId)
      .maybeSingle();
    if (!invoice) return { success: false as const, error: 'Invoice not found' };

    const transitions: Record<string, {
      allowedRoles: Role[];
      from: InvoiceWorkflowStatus[];
      to: InvoiceWorkflowStatus;
      nextAssignee: Role | null;
    }> = {
      submit_for_check: {
        allowedRoles: ['Maker', 'Admin'],
        from: ['draft', 'returned_by_checker', 'returned_by_approver'],
        to: 'submitted_for_check',
        nextAssignee: 'Checker',
      },
      checker_return: {
        allowedRoles: ['Checker', 'Admin'],
        from: ['submitted_for_check'],
        to: 'returned_by_checker',
        nextAssignee: 'Maker',
      },
      checker_accept: {
        allowedRoles: ['Checker', 'Admin'],
        from: ['submitted_for_check'],
        to: 'checked',
        nextAssignee: 'Approver',
      },
      approver_return: {
        allowedRoles: ['Approver', 'Admin'],
        from: ['checked'],
        to: 'returned_by_approver',
        nextAssignee: 'Maker',
      },
      approver_approve: {
        allowedRoles: ['Approver', 'Admin'],
        from: ['checked'],
        to: 'approved_for_submission',
        nextAssignee: 'Approver',
      },
    };

    const spec = transitions[action];
    if (!spec) return { success: false as const, error: 'Unknown action' };
    if (!spec.allowedRoles.includes(actor.role) || !spec.from.includes(invoice.workflow_status)) {
      return { success: false as const, error: 'Transition not allowed for current role or status' };
    }

    const { data: updated, error } = await supabaseAdmin
      .from('bank_invoices')
      .update({
        workflow_status: spec.to,
        current_assignee_role: spec.nextAssignee,
        last_comment: comment || null,
        updated_at: nowIso(),
      })
      .eq('id', invoiceId)
      .eq('organization_id', actor.organizationId)
      .select('*')
      .single();
    if (error) return { success: false as const, error: error.message };

    if (comment) {
      await supabaseAdmin.from('bank_invoice_comments').insert({
        organization_id: actor.organizationId,
        invoice_id: invoiceId,
        by_user_id: actor.id,
        by_role: actor.role,
        by_name: actor.fullName,
        comment,
      });
    }
    await supabaseAdmin.from('bank_invoice_workflow_events').insert({
      organization_id: actor.organizationId,
      invoice_id: invoiceId,
      action,
      by_user_id: actor.id,
      by_role: actor.role,
      comment: comment || null,
    });

    return {
      success: true as const,
      invoice: {
        id: updated.id,
        invoiceNumber: updated.invoice_number,
        customerId: updated.customer_id,
        type: updated.invoice_type,
        documentType: updated.document_type,
        status: updated.workflow_status,
        totalAmount: Number(updated.total_amount || 0),
        vatAmount: Number(updated.vat_amount || 0),
        currency: updated.currency || 'SAR',
        items: updated.items || [],
        customerSnapshot: updated.customer_snapshot || {},
        createdByUserId: updated.created_by_user_id,
        currentAssigneeRole: updated.current_assignee_role,
        workflowComments: [],
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    };
  }

  return mutateState((state) => {
    const invoice = state.invoices.find((inv) => inv.id === invoiceId);
    if (!invoice) return { success: false as const, error: 'Invoice not found' };

    const transitions: Record<string, {
      allowedRoles: Role[];
      from: InvoiceWorkflowStatus[];
      to: InvoiceWorkflowStatus;
      nextAssignee: Role | null;
    }> = {
      submit_for_check: {
        allowedRoles: ['Maker', 'Admin'],
        from: ['draft', 'returned_by_checker', 'returned_by_approver'],
        to: 'submitted_for_check',
        nextAssignee: 'Checker',
      },
      checker_return: {
        allowedRoles: ['Checker', 'Admin'],
        from: ['submitted_for_check'],
        to: 'returned_by_checker',
        nextAssignee: 'Maker',
      },
      checker_accept: {
        allowedRoles: ['Checker', 'Admin'],
        from: ['submitted_for_check'],
        to: 'checked',
        nextAssignee: 'Approver',
      },
      approver_return: {
        allowedRoles: ['Approver', 'Admin'],
        from: ['checked'],
        to: 'returned_by_approver',
        nextAssignee: 'Maker',
      },
      approver_approve: {
        allowedRoles: ['Approver', 'Admin'],
        from: ['checked'],
        to: 'approved_for_submission',
        nextAssignee: 'Approver',
      },
    };

    const spec = transitions[action];
    if (!spec) return { success: false as const, error: 'Unknown action' };
    if (!spec.allowedRoles.includes(actor.role) || !spec.from.includes(invoice.status)) {
      return { success: false as const, error: 'Transition not allowed for current role or status' };
    }

    invoice.status = spec.to;
    invoice.currentAssigneeRole = spec.nextAssignee;
    invoice.updatedAt = nowIso();
    invoice.lastComment = comment;

    // Add workflow comment if provided
    if (comment) {
      if (!invoice.workflowComments) invoice.workflowComments = [];
      invoice.workflowComments.push({
        id: createId(),
        invoiceId: invoice.id,
        byUserId: actor.id,
        byRole: actor.role,
        byName: actor.fullName,
        comment,
        createdAt: nowIso(),
      });
    }

    state.invoiceWorkflowEvents.unshift({
      id: createId(),
      invoiceId: invoice.id,
      action,
      byUserId: actor.id,
      byRole: actor.role,
      comment,
      createdAt: nowIso(),
    });
    pushAudit(state, {
      category: 'workflow',
      action,
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetId: invoice.id,
      message: `${actor.email} executed ${action} on ${invoice.invoiceNumber}`,
    });

    return { success: true as const, invoice };
  });
}

/* ─── Add comment without transition ─── */

export async function addWorkflowComment(
  actor: ProductUser,
  invoiceId: string,
  comment: string
) {
  if (actor.organizationId) {
    const { data: invoice } = await supabaseAdmin
      .from('bank_invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('organization_id', actor.organizationId)
      .maybeSingle();
    if (!invoice) return { success: false as const, error: 'Invoice not found' };

    await supabaseAdmin.from('bank_invoice_comments').insert({
      organization_id: actor.organizationId,
      invoice_id: invoiceId,
      by_user_id: actor.id,
      by_role: actor.role,
      by_name: actor.fullName,
      comment,
    });
    const { data: updated } = await supabaseAdmin
      .from('bank_invoices')
      .update({ last_comment: comment, updated_at: nowIso() })
      .eq('id', invoiceId)
      .eq('organization_id', actor.organizationId)
      .select('*')
      .single();
    return {
      success: true as const,
      invoice: {
        id: updated.id,
        invoiceNumber: updated.invoice_number,
        customerId: updated.customer_id,
        type: updated.invoice_type,
        documentType: updated.document_type,
        status: updated.workflow_status,
        totalAmount: Number(updated.total_amount || 0),
        vatAmount: Number(updated.vat_amount || 0),
        currency: updated.currency || 'SAR',
        items: updated.items || [],
        customerSnapshot: updated.customer_snapshot || {},
        createdByUserId: updated.created_by_user_id,
        currentAssigneeRole: updated.current_assignee_role,
        workflowComments: [],
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    };
  }

  return mutateState((state) => {
    const invoice = state.invoices.find((inv) => inv.id === invoiceId);
    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (!invoice.workflowComments) invoice.workflowComments = [];
    invoice.workflowComments.push({
      id: createId(),
      invoiceId: invoice.id,
      byUserId: actor.id,
      byRole: actor.role,
      byName: actor.fullName,
      comment,
      createdAt: nowIso(),
    });
    invoice.updatedAt = nowIso();
    return { success: true as const, invoice };
  });
}

/* ─── Submit to Middleware (Internal) ─── */

export async function submitInvoiceToMiddleware(actor: ProductUser, invoiceId: string) {
  if (actor.organizationId) {
    const { data: invoice } = await supabaseAdmin
      .from('bank_invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('organization_id', actor.organizationId)
      .maybeSingle();
    if (!invoice) return { success: false as const, error: 'Invoice not found' };
    if (!(actor.role === 'Approver' || actor.role === 'Admin')) {
      return { success: false as const, error: 'Only approvers or admins can submit to middleware' };
    }
    if (invoice.workflow_status !== 'approved_for_submission') {
      return { success: false as const, error: 'Invoice must be approved before submission' };
    }

    const { data: integration } = await supabaseAdmin
      .from('bank_integration_settings')
      .select('middleware_base_url, middleware_api_key')
      .eq('organization_id', actor.organizationId)
      .maybeSingle();
    const baseUrl = (integration?.middleware_base_url || '').replace(/\/$/, '');
    const apiKey = (integration?.middleware_api_key || '').trim();
    if (!baseUrl) return { success: false as const, error: 'Middleware base URL is not configured. Ask Admin to configure integration settings.' };
    if (!apiKey) return { success: false as const, error: 'Middleware API key is missing. Ask Admin to configure integration settings.' };

    await supabaseAdmin
      .from('bank_invoices')
      .update({ workflow_status: 'submitted_to_middleware', updated_at: nowIso() })
      .eq('id', invoiceId)
      .eq('organization_id', actor.organizationId);

    const payload = {
      type: invoice.invoice_type,
      documentType: invoice.document_type,
      invoiceId: invoice.invoice_number,
      buyer: {
        partyIdentification: invoice.customer_snapshot?.identificationNumber
          ? {
              schemeID: invoice.customer_snapshot.identificationScheme,
              id: invoice.customer_snapshot.identificationNumber,
            }
          : undefined,
        postalAddress: invoice.customer_snapshot?.address,
        partyTaxScheme: invoice.customer_snapshot?.vatNumber
          ? { companyID: invoice.customer_snapshot.vatNumber }
          : undefined,
        partyLegalEntity: {
          registrationName: invoice.customer_snapshot?.registrationName,
        },
      },
      items: invoice.items || [],
    };

    let response: Response;
    let data: any;
    try {
      response = await fetch(`${baseUrl}/api/v1/zatca/invoices/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(payload),
      });
      data = await response.json().catch(() => ({}));
    } catch (err: any) {
      await supabaseAdmin
        .from('bank_invoices')
        .update({
          workflow_status: 'failed_submission',
          current_assignee_role: 'Approver',
          updated_at: nowIso(),
        })
        .eq('id', invoiceId)
        .eq('organization_id', actor.organizationId);
      return { success: false as const, error: `Middleware unreachable: ${err?.message}` };
    }

    const success = response.ok && data?.success;
    const nextStatus = success
      ? (data.zatcaStatus === 'REPORTED' ? 'reported' : 'cleared')
      : (data?.zatcaStatus === 'REJECTED' ? 'rejected' : 'failed_submission');
    const nextAssignee = success ? null : 'Approver';

    const { data: updated } = await supabaseAdmin
      .from('bank_invoices')
      .update({
        workflow_status: nextStatus,
        current_assignee_role: nextAssignee,
        middleware_status: data?.zatcaStatus || null,
        middleware_invoice_id: data?.invoiceId || null,
        middleware_uuid: data?.uuid || null,
        invoice_hash: data?.invoiceHash || null,
        qr_code: data?.qrCode || null,
        signed_xml: data?.signedXml || null,
        validation_messages: data?.validationMessages || [],
        updated_at: nowIso(),
      })
      .eq('id', invoiceId)
      .eq('organization_id', actor.organizationId)
      .select('*')
      .single();

    const invoiceResult = {
      id: updated.id,
      invoiceNumber: updated.invoice_number,
      customerId: updated.customer_id,
      type: updated.invoice_type,
      documentType: updated.document_type,
      status: updated.workflow_status,
      totalAmount: Number(updated.total_amount || 0),
      vatAmount: Number(updated.vat_amount || 0),
      currency: updated.currency || 'SAR',
      items: updated.items || [],
      customerSnapshot: updated.customer_snapshot || {},
      createdByUserId: updated.created_by_user_id,
      currentAssigneeRole: updated.current_assignee_role,
      middlewareInvoiceId: updated.middleware_invoice_id || undefined,
      middlewareUuid: updated.middleware_uuid || undefined,
      middlewareStatus: updated.middleware_status || undefined,
      invoiceHash: updated.invoice_hash || undefined,
      qrCode: updated.qr_code || undefined,
      signedXml: updated.signed_xml || undefined,
      validationMessages: updated.validation_messages || [],
      workflowComments: [],
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    };

    return success
      ? { success: true as const, invoice: invoiceResult, middlewareResponse: data }
      : { success: false as const, error: data?.error || 'Submission failed', invoice: invoiceResult, middlewareResponse: data };
  }

  const state = await readState();
  const invoice = state.invoices.find((inv) => inv.id === invoiceId);
  if (!invoice) return { success: false as const, error: 'Invoice not found' };
  if (!(actor.role === 'Approver' || actor.role === 'Admin')) {
    return { success: false as const, error: 'Only approvers or admins can submit to middleware' };
  }
  if (invoice.status !== 'approved_for_submission') {
    return { success: false as const, error: 'Invoice must be approved before submission' };
  }

  const baseUrl = (state.integration.middlewareBaseUrl || '').replace(/\/$/, '');
  const apiKey = (state.integration.middlewareApiKey || '').trim();

  if (!baseUrl) {
    return { success: false as const, error: 'Middleware base URL is not configured. Ask Admin to configure integration settings.' };
  }
  if (!apiKey) {
    return { success: false as const, error: 'Middleware API key is missing. Ask Admin to configure integration settings.' };
  }

  invoice.status = 'submitted_to_middleware';
  invoice.updatedAt = nowIso();
  await writeState(state);

  // Build payload for internal middleware API call
  const payload = {
    type: invoice.type,
    documentType: invoice.documentType,
    invoiceId: invoice.invoiceNumber,
    buyer: {
      partyIdentification: invoice.customerSnapshot.identificationNumber
        ? {
            schemeID: invoice.customerSnapshot.identificationScheme,
            id: invoice.customerSnapshot.identificationNumber,
          }
        : undefined,
      postalAddress: invoice.customerSnapshot.address,
      partyTaxScheme: invoice.customerSnapshot.vatNumber
        ? { companyID: invoice.customerSnapshot.vatNumber }
        : undefined,
      partyLegalEntity: {
        registrationName: invoice.customerSnapshot.registrationName,
      },
    },
    items: invoice.items,
  };

  // Call internal middleware invoice submission API
  let response: Response;
  let data: any;

  try {
    response = await fetch(`${baseUrl}/api/v1/zatca/invoices/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });
    data = await response.json().catch(() => ({}));
  } catch (err: any) {
    // If internal call fails, mark as failed
    return mutateState((fresh) => {
      const target = fresh.invoices.find((inv) => inv.id === invoiceId);
      if (!target) return { success: false as const, error: 'Invoice disappeared' };
      target.status = 'failed_submission';
      target.currentAssigneeRole = 'Approver';
      target.updatedAt = nowIso();
      pushAudit(fresh, {
        category: 'invoices',
        action: 'middleware_submission_failed',
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetId: target.id,
        message: `Internal middleware call failed for ${target.invoiceNumber}: ${err?.message}`,
      });
      return { success: false as const, error: `Middleware unreachable: ${err?.message}`, invoice: target };
    });
  }

  return mutateState((fresh) => {
    const target = fresh.invoices.find((inv) => inv.id === invoiceId);
    if (!target) return { success: false as const, error: 'Invoice disappeared during submission' };

    target.updatedAt = nowIso();
    target.middlewareStatus = data?.zatcaStatus;
    target.middlewareInvoiceId = data?.invoiceId;
    target.middlewareUuid = data?.uuid;
    target.invoiceHash = data?.invoiceHash;
    target.qrCode = data?.qrCode;
    target.signedXml = data?.signedXml;
    target.validationMessages = data?.validationMessages || [];

    if (response!.ok && data?.success) {
      target.status = data.zatcaStatus === 'REPORTED' ? 'reported' : 'cleared';
      target.currentAssigneeRole = null;
      pushAudit(fresh, {
        category: 'invoices',
        action: 'submitted_to_middleware',
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetId: target.id,
        message: `${actor.email} submitted ${target.invoiceNumber} to middleware`,
        metadata: { zatcaStatus: data.zatcaStatus },
      });
    } else {
      target.status = data?.zatcaStatus === 'REJECTED' ? 'rejected' : 'failed_submission';
      target.currentAssigneeRole = 'Approver';
      pushAudit(fresh, {
        category: 'invoices',
        action: 'middleware_submission_failed',
        actorUserId: actor.id,
        actorEmail: actor.email,
        targetId: target.id,
        message: `${actor.email} attempted middleware submission for ${target.invoiceNumber}`,
        metadata: { error: data?.error || 'Submission failed' },
      });
    }

    fresh.invoiceWorkflowEvents.unshift({
      id: createId(),
      invoiceId: target.id,
      action: 'submitted_to_middleware',
      byUserId: actor.id,
      byRole: actor.role,
      comment: response!.ok ? data?.zatcaStatus : data?.error,
      createdAt: nowIso(),
    });

    return response!.ok && data?.success
      ? { success: true as const, invoice: target, middlewareResponse: data }
      : { success: false as const, error: data?.error || 'Submission failed', invoice: target, middlewareResponse: data };
  });
}

/* ─── Dashboard ─── */

export async function getDashboardSummary(organizationId?: string) {
  if (organizationId) {
    const { data: invoices } = await supabaseAdmin
      .from('bank_invoices')
      .select('*')
      .eq('organization_id', organizationId);
    const { data: customers } = await supabaseAdmin
      .from('bank_customers')
      .select('id')
      .eq('organization_id', organizationId);
    const { data: users } = await supabaseAdmin
      .from('bank_users')
      .select('id')
      .eq('organization_id', organizationId);
    const { data: integration } = await supabaseAdmin
      .from('bank_integration_settings')
      .select('middleware_api_key')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const allInvoices = invoices || [];
    return {
      organization: { id: organizationId, name: 'Bank Organization', passwordRotationDays: 14 },
      users: users?.length || 0,
      customers: customers?.length || 0,
      integrationConfigured: !!integration?.middleware_api_key,
      invoiceSummary: {
        total: allInvoices.length,
        drafts: allInvoices.filter((inv: any) => inv.workflow_status === 'draft').length,
        pendingReview: allInvoices.filter((inv: any) =>
          ['submitted_for_check', 'checked', 'approved_for_submission', 'submitted_to_middleware'].includes(inv.workflow_status)
        ).length,
        cleared: allInvoices.filter((inv: any) => inv.workflow_status === 'cleared').length,
        reported: allInvoices.filter((inv: any) => inv.workflow_status === 'reported').length,
        rejected: allInvoices.filter((inv: any) => ['rejected', 'failed_submission'].includes(inv.workflow_status)).length,
        totalVolumeSAR: allInvoices.reduce((sum: number, inv: any) => sum + Number(inv.total_amount || 0), 0).toFixed(2),
      },
      recentInvoices: allInvoices.slice(0, 5).map((row: any) => ({
        id: row.id,
        invoiceNumber: row.invoice_number,
        status: row.workflow_status,
        totalAmount: Number(row.total_amount || 0),
        createdAt: row.created_at,
      })),
      recentAuditLogs: [],
    };
  }

  const state = await readState();
  const invoices = state.invoices;
  return {
    organization: state.organization,
    users: state.users.length,
    customers: state.customers.length,
    integrationConfigured: !!state.integration.middlewareApiKey,
    invoiceSummary: {
      total: invoices.length,
      drafts: invoices.filter((inv) => inv.status === 'draft').length,
      pendingReview: invoices.filter((inv) =>
        ['submitted_for_check', 'checked', 'approved_for_submission', 'submitted_to_middleware'].includes(inv.status)
      ).length,
      cleared: invoices.filter((inv) => inv.status === 'cleared').length,
      reported: invoices.filter((inv) => inv.status === 'reported').length,
      rejected: invoices.filter((inv) => ['rejected', 'failed_submission'].includes(inv.status)).length,
      totalVolumeSAR: invoices.reduce((sum, inv) => sum + inv.totalAmount, 0).toFixed(2),
    },
    recentInvoices: invoices.slice(0, 5),
    recentAuditLogs: state.auditLogs.slice(0, 8),
  };
}

export async function getAuditLogs() {
  const state = await readState();
  return state.auditLogs;
}

export async function getWorkflowEvents(invoiceId?: string) {
  const state = await readState();
  return invoiceId
    ? state.invoiceWorkflowEvents.filter((e) => e.invoiceId === invoiceId)
    : state.invoiceWorkflowEvents;
}
