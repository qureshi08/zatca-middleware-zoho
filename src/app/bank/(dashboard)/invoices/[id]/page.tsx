'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useBankAuthStore } from '@/store/bankAuthStore';
import { 
  ChevronLeft, Clock, Send, ShieldCheck, Stamp, CheckCircle2, 
  AlertCircle, MessageSquare, History, User, Building2, Receipt,
  FileEdit, Trash2, Globe, ExternalLink, ArrowRight
} from 'lucide-react';
import Link from 'next/link';
import InvoiceForm from '@/components/bank/InvoiceForm';

export default function BankInvoiceDetailPage() {
  const { id } = useParams() as { id: string };
  const { sessionToken, role, integrationConfigured } = useBankAuthStore();
  
  const [invoice, setInvoice] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!sessionToken) return;
    try {
      const resp = await fetch(`/api/bank/product/invoices/${id}`, {
        headers: { 'x-session-token': sessionToken }
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setInvoice(data.invoice);

      if (['draft', 'returned_by_checker', 'returned_by_approver'].includes(data.invoice.status)) {
        const [custResp, invResp] = await Promise.all([
          fetch('/api/bank/product/customers', { headers: { 'x-session-token': sessionToken } }),
          fetch('/api/bank/product/invoices', { headers: { 'x-session-token': sessionToken } })
        ]);
        const custData = await custResp.json();
        const invData = await invResp.json();
        setCustomers(custData.customers || []);
        
        const validInvoices = (invData.invoices || []).filter((inv: any) => 
          ['cleared', 'reported'].includes(inv.status)
        );
        setInvoices(validInvoices);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id, sessionToken]);

  const handleAction = async (endpoint: string, body?: any) => {
    if (!sessionToken) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bank/product/invoices/${id}/${endpoint}`, {
        method: 'POST',
        headers: {
          'x-session-token': sessionToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...body, comment })
      });
      const data = await res.json();
      if (!res.ok) {
        const messageParts = [data.error || 'Failed to process action'];
        if (Array.isArray(data?.invoice?.validationMessages) && data.invoice.validationMessages.length > 0) {
          messageParts.push(`Validation: ${data.invoice.validationMessages.join(' | ')}`);
        }
        setError(messageParts.join('\n'));
        if (data.invoice) setInvoice(data.invoice); // Update status even on fail (e.g. failed_submission)
        return;
      }
      setComment('');
      setInvoice(data.invoice);
    } catch (e) {
      setError('Connection error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditSave = async (formData: any) => {
    if (!sessionToken) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/bank/product/invoices/${id}`, {
        method: 'PUT',
        headers: {
          'x-session-token': sessionToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInvoice(data.invoice);
      setIsEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="p-20 text-center text-small animate-pulse">Loading secure invoice data...</div>;
  if (!invoice) return <div className="p-20 text-center text-red-500 font-bold">Invoice record not found.</div>;

  const steps = [
    { key: 'draft', label: 'Created', icon: Clock },
    { key: 'submitted_for_check', label: 'Pending Verification', icon: Send },
    { key: 'checked', label: 'Verified', icon: ShieldCheck },
    { key: 'approved_for_submission', label: 'Approved', icon: Stamp },
    { key: 'cleared', label: 'Submitted / Cleared', icon: CheckCircle2 }
  ];

  const currentStepIndex = steps.findIndex(s => {
    if (s.key === 'cleared') return ['cleared', 'reported', 'submitted_to_middleware'].includes(invoice.status);
    if (s.key === 'draft') return ['draft', 'returned_by_checker', 'returned_by_approver'].includes(invoice.status);
    return invoice.status === s.key;
  });

  const getStepStatus = (index: number) => {
    if (index < currentStepIndex) return 'completed';
    if (index === currentStepIndex) {
      if (invoice.status.startsWith('returned')) return 'error';
      if (['failed_submission', 'rejected'].includes(invoice.status)) return 'error';
      return 'active';
    }
    return 'pending';
  };

  const isMaker = role === 'Maker' || role === 'Admin';
  const isChecker = role === 'Checker' || role === 'Admin';
  const isApprover = role === 'Approver' || role === 'Admin';
  const submitBlockedReason =
    !integrationConfigured
      ? 'Integration is not configured. Ask Admin to complete Bank Setup first.'
      : null;

  return (
    <div className="animate-pro pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Link href="/bank/invoices" className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500 lg:-ml-12">
            <ChevronLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="h1">{invoice.invoiceNumber}</h1>
              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                invoice.status === 'cleared' ? 'bg-green-100 text-green-700' : 
                invoice.status.startsWith('returned') ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'
              }`}>
                {invoice.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-small">{invoice.type} Tax Invoice · {new Date(invoice.createdAt).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {error && <div className="bank-alert-error mb-6">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          {/* Progress Tracker */}
          <div className="card-pro p-5 bg-gradient-to-r from-gray-50/50 to-white">
            <div className="flex justify-between relative">
              <div className="absolute top-4 left-0 right-0 h-0.5 bg-gray-100 -z-0"></div>
              {steps.map((step, idx) => {
                const s = getStepStatus(idx);
                const Icon = step.icon;
                return (
                  <div key={idx} className="flex flex-col items-center gap-2 relative z-10 w-1/5 text-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                      s === 'completed' ? 'bg-blue-600 border-blue-600 text-white' :
                      s === 'active' ? 'bg-white border-blue-600 text-blue-600 ring-4 ring-blue-50' :
                      s === 'error' ? 'bg-red-500 border-red-500 text-white' : 'bg-white border-gray-100 text-gray-300'
                    }`}>
                      <Icon size={14} />
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-tighter ${
                      s === 'pending' ? 'text-gray-300' : s === 'error' ? 'text-red-600' : 'text-gray-900'
                    }`}>{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card-pro p-6 space-y-8">
            <div className="flex justify-between items-start">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-gray-400">
                  <Building2 size={16} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Buyer Details</span>
                </div>
                <div className="pl-6">
                  <p className="text-[15px] font-black text-gray-900 tracking-tight">{invoice.customerSnapshot?.registrationName}</p>
                  <p className="text-[11px] text-gray-500 font-medium">VAT: {invoice.customerSnapshot?.vatNumber}</p>
                  <div className="mt-2 text-[11px] text-gray-400 space-y-0.5">
                    <p>{invoice.customerSnapshot?.address?.streetName}, {invoice.customerSnapshot?.address?.buildingNumber}</p>
                    <p>{invoice.customerSnapshot?.address?.cityName}, {invoice.customerSnapshot?.address?.postalZone}</p>
                    <p>{invoice.customerSnapshot?.address?.country}</p>
                  </div>
                </div>
              </div>

              <div className="text-right space-y-1">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Integration ID</p>
                <p className="text-[12px] font-bold text-gray-900 tabular-nums">{invoice.middlewareUuid || 'PENDING'}</p>
                {invoice.middlewareStatus && (
                  <div className="flex items-center justify-end gap-1 mt-2 text-green-600 font-bold text-[10px] uppercase">
                    <Globe size={12} />
                    ZATCA: {invoice.middlewareStatus}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 text-gray-400">
                <Receipt size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest">Line Items</span>
              </div>
              
              <div className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50/20">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-100/50">
                      <th className="p-2.5 text-[9px] font-black uppercase text-gray-400">Description</th>
                      <th className="p-2.5 text-[9px] font-black uppercase text-gray-400 text-center">Qty</th>
                      <th className="p-2.5 text-[9px] font-black uppercase text-gray-400 text-right">Price</th>
                      <th className="p-2.5 text-[9px] font-black uppercase text-gray-400 text-right">VAT%</th>
                      <th className="p-2.5 text-[9px] font-black uppercase text-gray-400 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {invoice.items.map((item: any, i: number) => (
                      <tr key={i} className="text-[11px] text-gray-700">
                        <td className="p-2.5 font-medium">{item.name}</td>
                        <td className="p-2.5 text-center px-4">{item.quantity}</td>
                        <td className="p-2.5 text-right font-mono tabular-nums">{item.unitPrice.toFixed(2)}</td>
                        <td className="p-2.5 text-right px-4 text-gray-400">{item.vatRate}%</td>
                        <td className="p-2.5 text-right font-bold text-gray-900 tabular-nums">
                          {(item.quantity * item.unitPrice * (1 + item.vatRate / 100)).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="flex justify-end pt-4 border-t border-gray-100">
                 <div className="space-y-2 w-full max-w-[200px]">
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold text-gray-400">
                      <span>Subtotal</span>
                      <span className="text-gray-900 font-black">SAR {(invoice.totalAmount - invoice.vatAmount).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold text-blue-400">
                      <span>VAT Total</span>
                      <span className="text-blue-600 font-black">SAR {invoice.vatAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[12px] uppercase font-black text-blue-900 pt-2 border-t border-gray-50">
                      <span>Total Payable</span>
                      <span className="text-[15px]">SAR {invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                 </div>
              </div>
            </div>
            
            {invoice.validationMessages?.length > 0 && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 space-y-2">
                <p className="text-[10px] font-black text-red-600 uppercase tracking-widest flex items-center gap-1.5">
                  <AlertCircle size={14} />
                  Middleware Validation Warnings
                </p>
                <div className="space-y-1 pl-5">
                  {invoice.validationMessages.map((msg: string, i: number) => (
                    <p key={i} className="text-[11px] text-red-700 leading-tight">· {msg}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card-pro p-6">
             <div className="flex items-center gap-2 mb-4 text-gray-400">
                <History size={16} />
                <span className="text-[10px] font-black uppercase tracking-widest">Workflow Timeline</span>
             </div>
             <div className="space-y-6 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-100 text-[11px]">
                {invoice.workflowComments?.map((c: any) => (
                  <div key={c.id} className="relative pl-8">
                     <div className="absolute left-0 top-0.5 w-6 h-6 rounded-full bg-white border-2 border-gray-100 flex items-center justify-center text-gray-400 z-10">
                        <User size={10} />
                     </div>
                     <div className="flex justify-between mb-1">
                        <p className="font-black text-gray-900">{c.byName} <span className="text-[9px] font-bold text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded ml-1 uppercase">{c.byRole}</span></p>
                        <p className="text-[9px] text-gray-400">{new Date(c.createdAt).toLocaleString()}</p>
                     </div>
                     <div className="p-2.5 rounded-lg bg-gray-50/80 border border-gray-100/50 text-gray-600 leading-relaxed italic">
                        {c.comment}
                     </div>
                  </div>
                ))}
                {(invoice.workflowComments?.length === 0 || !invoice.workflowComments) && (
                   <div className="pl-8 text-gray-300 italic py-2">No internal comments yet.</div>
                )}
             </div>
          </div>
        </div>

        {/* Action Panel */}
        <div className="lg:col-span-4 space-y-6 sticky top-6">
          <div className="card-pro p-5 shadow-xl shadow-blue-900/5 border-blue-100/50 ring-1 ring-blue-50">
            <h3 className="h3 mb-1">Workflow Actions</h3>
            <p className="text-[11px] text-gray-400 mb-6">Authorize, return, or transmit this document.</p>
            
            {invoice.status === 'cleared' || invoice.status === 'reported' ? (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-center space-y-3">
                 <CheckCircle2 size={32} className="text-emerald-500 mx-auto" />
                 <p className="text-[12px] font-black text-emerald-800 uppercase">Process Complete</p>
                 <p className="text-[10px] text-emerald-600">The invoice has been successfully submitted to ZATCA and archived.</p>
                 {invoice.middlewareUuid && (
                   <div className="mt-2 p-2 bg-white/60 rounded-lg border border-emerald-100/50">
                     <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">ZATCA Reference</p>
                     <p className="text-[11px] font-mono font-bold text-gray-700 break-all">{invoice.middlewareUuid}</p>
                   </div>
                 )}
              </div>
            ) : isEditing ? (
               <div className="animate-pro p-4 bg-white border border-blue-100 rounded-xl">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] font-black uppercase text-blue-600">Edit Mode Active</span>
                    <button onClick={() => setIsEditing(false)} className="text-[10px] font-bold text-gray-400 hover:text-gray-900">Cancel</button>
                  </div>
                  <InvoiceForm 
                    initialData={invoice} 
                    customers={customers} 
                    invoices={invoices}
                    onSave={handleEditSave} 
                    isSaving={actionLoading} 
                  />
               </div>
            ) : (
              <div className="space-y-4">
                <div className="bank-form-group">
                  <label className="bank-form-label flex items-center gap-1.5 uppercase text-[9px] font-black">
                    <MessageSquare size={12} />
                    Internal Remark / Rejection Reason
                  </label>
                  <textarea 
                    className="input-pro min-h-[80px] py-2 text-[12px] leading-relaxed" 
                    placeholder="Provide context for your action..."
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                  ></textarea>
                </div>

                <div className="space-y-2">
                  {/* Maker Actions */}
                  {isMaker && ['draft', 'returned_by_checker', 'returned_by_approver'].includes(invoice.status) && (
                    <>
                      <button 
                        onClick={() => handleAction('submit-for-check')}
                        className="btn-pro w-full h-10 px-4 bg-blue-600 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                        disabled={actionLoading}
                      >
                        <Send size={15} />
                        Submit for Verification
                      </button>
                      <button 
                        onClick={() => setIsEditing(true)}
                        className="btn-pro w-full h-10 px-4 bg-white text-gray-700 border-gray-200 hover:bg-gray-50 flex items-center justify-center gap-2"
                        disabled={actionLoading}
                      >
                        <FileEdit size={15} />
                        Modify Invoice Detail
                      </button>
                    </>
                  )}

                  {/* Checker Actions */}
                  {isChecker && invoice.status === 'submitted_for_check' && (
                    <>
                      <button 
                        onClick={() => handleAction('check', { approved: true })}
                        className="btn-pro w-full h-10 px-4 bg-indigo-600 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                        disabled={actionLoading}
                      >
                        <ShieldCheck size={15} />
                        Accept Verification
                      </button>
                      <button 
                        onClick={() => handleAction('check', { approved: false })}
                        className="btn-pro w-full h-10 px-4 bg-white text-red-600 border-red-100 hover:bg-red-50 flex items-center justify-center gap-2"
                        disabled={actionLoading || !comment}
                        title={!comment ? 'Comment required for return' : ''}
                      >
                        <ArrowRight size={15} className="rotate-180" />
                        Return to Maker
                      </button>
                    </>
                  )}

                  {/* Approver Actions */}
                  {isApprover && invoice.status === 'checked' && (
                    <>
                      <button 
                        onClick={() => handleAction('approve', { approved: true })}
                        className="btn-pro w-full h-10 px-4 bg-emerald-600 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                        disabled={actionLoading}
                      >
                        <Stamp size={15} />
                        Approve for Submission
                      </button>
                      <button 
                        onClick={() => handleAction('approve', { approved: false })}
                        className="btn-pro w-full h-10 px-4 bg-white text-red-600 border-red-100 hover:bg-red-50 flex items-center justify-center gap-2"
                        disabled={actionLoading || !comment}
                        title={!comment ? 'Comment required for return' : ''}
                      >
                        <ArrowRight size={15} className="rotate-180" />
                        Reject & Return
                      </button>
                    </>
                  )}

                  {/* Final Submission */}
                  {isApprover && invoice.status === 'approved_for_submission' && (
                    <button 
                      onClick={() => handleAction('submit')}
                      className="btn-pro w-full h-10 px-4 bg-gradient-to-r from-blue-700 to-indigo-800 text-white flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30"
                      disabled={actionLoading || !!submitBlockedReason}
                      title={submitBlockedReason || ''}
                    >
                      <Globe size={15} />
                      Transmit to ZATCA
                    </button>
                  )}
                  {isApprover && invoice.status === 'approved_for_submission' && submitBlockedReason && (
                    <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      {submitBlockedReason}
                    </p>
                  )}

                  {/* Any role can comment */}
                  <button 
                    onClick={() => handleAction('comment')}
                    className="w-full text-center py-2 text-[10px] font-black text-gray-400 hover:text-gray-600 uppercase tracking-widest transition-colors"
                    disabled={actionLoading || !comment}
                  >
                    Add Remark Only
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <div className="card-pro p-4 bg-amber-50/50 border-amber-100">
             <div className="flex items-center gap-2 mb-2 text-amber-600">
                <AlertCircle size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Compliance Note</span>
             </div>
             <p className="text-[10px] text-amber-700 leading-relaxed">
                Modification is only possible in 'Draft' or 'Returned' status. Verified documents are locked to maintain the integrity of the audit chain before ZATCA transmission.
             </p>
          </div>
        </div>
      </div>
    </div>
  );
}
