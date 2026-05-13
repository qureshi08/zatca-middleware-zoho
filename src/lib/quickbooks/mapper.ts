/**
 * QUICKBOOKS TO ZATCA MAPPER (v1.0)
 * Translates QBO Invoice JSON into the Middleware's internal ZATCA format.
 */

export function mapQBInvoiceToZatca(qbInvoice: any) {
  return {
    invoiceNumber: qbInvoice.DocNumber || `QB-${qbInvoice.Id}`,
    issueDate: qbInvoice.TxnDate,
    issueTime: "12:00:00", // QBO TxnDate usually doesn't have precise time
    invoiceType: "388", // Standard Tax Invoice
    paymentMethod: "42", // Bank Account (Standard Default)
    currency: qbInvoice.CurrencyRef?.value || "SAR",
    
    // Customer Mapping
    customer: {
      name: qbInvoice.CustomerRef.name,
      taxNumber: qbInvoice.CustomField?.find((f: any) => f.Name === "TaxNumber")?.StringValue || "300000000000003", // Fallback
      address: qbInvoice.BillAddr?.Line1 || "Saudi Arabia",
      city: qbInvoice.BillAddr?.City || "Riyadh",
      postalZone: qbInvoice.BillAddr?.PostalCode || "12211",
      countryCode: "SA"
    },

    // Line Items Mapping
    items: qbInvoice.Line
      .filter((line: any) => line.DetailType === "SalesItemLineDetail")
      .map((line: any) => ({
        name: line.Description || line.SalesItemLineDetail.ItemRef.name,
        quantity: line.SalesItemLineDetail.Qty || 1,
        unitPrice: line.SalesItemLineDetail.UnitPrice,
        discount: 0,
        vatRate: 15, // Default for KSA
        taxType: "S" // Standard Rate
      })),
    
    totalAmount: qbInvoice.TotalAmt,
    taxAmount: (qbInvoice.TxnTaxDetail?.TotalTax) || (qbInvoice.TotalAmt * 0.15 / 1.15) // Approximation if missing
  };
}
