/**
 * ZATCA INVOICE VALIDATOR
 *
 * Implements the ~25 highest-impact ZATCA business rules so the local
 * simulation mirrors what the real ZATCA Compliance/Production validators
 * would reject or warn on.
 *
 * Coverage philosophy:
 *  - All rules that real-world invoices most often trip on (totals
 *    arithmetic, mandatory parties, Saudi VAT format, decimal precision,
 *    line integrity, dates, currency).
 *  - Rules categorised ERROR (block clearance) vs WARNING (allow but
 *    surface in validationMessages, matching ZATCA's WARNING status).
 *
 * Not covered (intentional gaps — flagged so future contributors know):
 *  - Full XSD schema validation (UBL 2.1 structural correctness)
 *  - ICV strict sequencing across the org's invoice ledger
 *  - PIH chain integrity (we trust generatePreviousInvoiceHash)
 *  - QR TLV byte-level decode (we only check presence + base64 shape)
 *  - Credit/debit-note specific rules (BR-KSA-17/18, BR-CO-25 cross-doc)
 *  - Allowance/charge-line specific rules (we don't generate them yet)
 *  - All BR-AE-* (reverse charge) — not used in our flow
 */

const TOLERANCE = 0.01; // ZATCA accepts rounding diffs up to this on totals

export type Severity = 'ERROR' | 'WARNING';

export interface ValidationMessage {
  code: string;
  category: 'KSA' | 'CORE' | 'EN16931';
  message: string;
  status: Severity;
  context?: string;
}

export interface ValidationReport {
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
}

// ───────────────────────────────────────────────────────────── helpers

const findOne = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
};

const findAll = (xml: string, tag: string): string[] => {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
};

const findOneWithAttr = (
  xml: string,
  tag: string
): { value: string; attrs: Record<string, string> } | null => {
  const m = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  if (!m) return null;
  const attrs: Record<string, string> = {};
  const attrRe = /(\w[\w-]*)="([^"]*)"/g;
  let am;
  while ((am = attrRe.exec(m[1])) !== null) attrs[am[1]] = am[2];
  return { value: m[2].trim(), attrs };
};

const num = (s: string | null | undefined): number | null => {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const decimalsOf = (s: string): number => {
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
};

const close = (a: number, b: number, tol = TOLERANCE) => Math.abs(a - b) < tol;

// ───────────────────────────────────────────────────────────── main

export function validateZatcaXml(
  xml: string,
  type: 'standard' | 'simplified'
): ValidationReport {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  const push = (m: ValidationMessage) =>
    (m.status === 'ERROR' ? errors : warnings).push(m);

  validateHeaders(xml, push);
  validateInvoiceTypeCode(xml, type, push);
  validateDates(xml, push);
  validateCurrency(xml, push);
  validateSeller(xml, push);
  validateBuyer(xml, type, push);
  validateInvoiceLines(xml, push);
  validateVatBreakdown(xml, push);
  validateMonetaryTotals(xml, push);
  validateQrPresence(xml, push);

  return { errors, warnings };
}

// ───────────────────────────────────────────────────────────── headers

function validateHeaders(xml: string, push: (m: ValidationMessage) => void) {
  // BR-KSA-12: UBL Version must be 2.1
  const ublVersion = findOne(xml, 'cbc:UBLVersionID');
  if (ublVersion && ublVersion !== '2.1') {
    push({
      code: 'BR-KSA-12',
      category: 'KSA',
      status: 'ERROR',
      message: `UBLVersionID (BT-24) must be "2.1"; found "${ublVersion}".`,
    });
  }

  // BR-KSA-09: ProfileID
  const profileId = findOne(xml, 'cbc:ProfileID');
  if (profileId && profileId !== 'reporting:1.0') {
    push({
      code: 'BR-KSA-09',
      category: 'KSA',
      status: 'ERROR',
      message: `ProfileID (BT-23) must be "reporting:1.0"; found "${profileId}".`,
    });
  }

  // BR-KSA-EN16931-01: CustomizationID present (warning if missing)
  const customizationId = findOne(xml, 'cbc:CustomizationID');
  if (!customizationId) {
    push({
      code: 'BR-KSA-EN16931-01',
      category: 'EN16931',
      status: 'WARNING',
      message: 'CustomizationID (BT-24-1) is recommended for KSA invoices.',
    });
  }

  // Mandatory document UUID
  if (!findOne(xml, 'cbc:UUID')) {
    push({
      code: 'BR-KSA-08',
      category: 'KSA',
      status: 'ERROR',
      message: 'Document UUID (KSA-1) is missing.',
    });
  }

  // Mandatory document ID (BR-02)
  if (!findOne(xml, 'cbc:ID')) {
    push({
      code: 'BR-02',
      category: 'CORE',
      status: 'ERROR',
      message: 'Invoice number (BT-1) is missing.',
    });
  }
}

function validateInvoiceTypeCode(
  xml: string,
  type: 'standard' | 'simplified',
  push: (m: ValidationMessage) => void
) {
  const itc = findOneWithAttr(xml, 'cbc:InvoiceTypeCode');
  if (!itc) {
    push({
      code: 'BR-02-1',
      category: 'CORE',
      status: 'ERROR',
      message: 'InvoiceTypeCode (BT-3) is missing.',
    });
    return;
  }

  // BR-CL-15 (KSA scope): code must be one of 388 (invoice), 381 (credit), 383 (debit), 386 (prepayment)
  const validCodes = new Set(['388', '381', '383', '386']);
  if (!validCodes.has(itc.value)) {
    push({
      code: 'BR-CL-15',
      category: 'CORE',
      status: 'ERROR',
      message: `InvoiceTypeCode value "${itc.value}" is not a valid UN/EDIFACT 1001 code (expected 388/381/383/386).`,
    });
  }

  // BR-KSA-16: subtype (first 2 chars of the @name attribute) declares standard (01) vs simplified (02)
  const name = itc.attrs.name;
  if (!name || !/^\d{7}$/.test(name)) {
    push({
      code: 'BR-KSA-16',
      category: 'KSA',
      status: 'ERROR',
      message: `InvoiceTypeCode @name (KSA-2) must be a 7-digit transaction code; found "${name ?? ''}".`,
    });
    return;
  }

  const subtype = name.slice(0, 2);
  const expected = type === 'standard' ? '01' : '02';
  if (subtype !== expected) {
    push({
      code: 'BR-KSA-16',
      category: 'KSA',
      status: 'ERROR',
      message: `Transaction code subtype "${subtype}" does not match declared invoice type "${type}" (expected "${expected}").`,
    });
  }
}

// ───────────────────────────────────────────────────────────── dates

function validateDates(xml: string, push: (m: ValidationMessage) => void) {
  const issueDate = findOne(xml, 'cbc:IssueDate');
  const issueTime = findOne(xml, 'cbc:IssueTime');
  const dueDate = findOne(xml, 'cbc:DueDate');

  // BR-KSA-04: IssueDate format YYYY-MM-DD
  if (!issueDate) {
    push({
      code: 'BR-KSA-04',
      category: 'KSA',
      status: 'ERROR',
      message: 'IssueDate (BT-2) is missing.',
    });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    push({
      code: 'BR-KSA-04',
      category: 'KSA',
      status: 'ERROR',
      message: `IssueDate must be YYYY-MM-DD; found "${issueDate}".`,
    });
  }

  // BR-KSA-05: IssueTime format HH:MM:SS
  if (!issueTime) {
    push({
      code: 'BR-KSA-05',
      category: 'KSA',
      status: 'ERROR',
      message: 'IssueTime (KSA-25) is missing.',
    });
  } else if (!/^\d{2}:\d{2}:\d{2}$/.test(issueTime)) {
    push({
      code: 'BR-KSA-05',
      category: 'KSA',
      status: 'ERROR',
      message: `IssueTime must be HH:MM:SS; found "${issueTime}".`,
    });
  }

  // BR-CO-25: DueDate >= IssueDate (warning, not error)
  if (issueDate && dueDate && dueDate < issueDate) {
    push({
      code: 'BR-CO-25',
      category: 'CORE',
      status: 'WARNING',
      message: `DueDate (${dueDate}) is earlier than IssueDate (${issueDate}).`,
    });
  }
}

// ───────────────────────────────────────────────────────────── currency

function validateCurrency(xml: string, push: (m: ValidationMessage) => void) {
  const docCurrency = findOne(xml, 'cbc:DocumentCurrencyCode');
  const taxCurrency = findOne(xml, 'cbc:TaxCurrencyCode');

  // BR-CL-04: DocumentCurrencyCode must be present and 3-letter
  if (!docCurrency) {
    push({
      code: 'BR-CL-04',
      category: 'CORE',
      status: 'ERROR',
      message: 'DocumentCurrencyCode (BT-5) is missing.',
    });
  } else if (!/^[A-Z]{3}$/.test(docCurrency)) {
    push({
      code: 'BR-CL-04',
      category: 'CORE',
      status: 'ERROR',
      message: `DocumentCurrencyCode "${docCurrency}" is not a valid ISO 4217 alphabetic code.`,
    });
  }

  // BR-KSA-EN16931-02: TaxCurrencyCode must be SAR
  if (!taxCurrency) {
    push({
      code: 'BR-KSA-EN16931-02',
      category: 'KSA',
      status: 'ERROR',
      message: 'TaxCurrencyCode (BT-6) is missing.',
    });
  } else if (taxCurrency !== 'SAR') {
    push({
      code: 'BR-KSA-EN16931-02',
      category: 'KSA',
      status: 'ERROR',
      message: `TaxCurrencyCode must be "SAR"; found "${taxCurrency}".`,
    });
  }
}

// ───────────────────────────────────────────────────────────── seller

function validateSeller(xml: string, push: (m: ValidationMessage) => void) {
  const supplier = findOne(xml, 'cac:AccountingSupplierParty');
  if (!supplier) {
    push({
      code: 'BR-CO-26',
      category: 'CORE',
      status: 'ERROR',
      message: 'AccountingSupplierParty (BG-4) is missing.',
    });
    return;
  }

  // BR-08: Seller registration name
  const sellerName = findOne(supplier, 'cbc:RegistrationName');
  if (!sellerName) {
    push({
      code: 'BR-08',
      category: 'CORE',
      status: 'ERROR',
      message: 'Seller name (BT-27) is missing.',
    });
  }

  // BR-KSA-39: Saudi VAT must be 15 digits, start with 3, end with 03
  const taxScheme = findOne(supplier, 'cac:PartyTaxScheme');
  const sellerVat = taxScheme ? findOne(taxScheme, 'cbc:CompanyID') : null;
  if (!sellerVat) {
    push({
      code: 'BR-CO-26',
      category: 'CORE',
      status: 'ERROR',
      message: 'Seller VAT identifier (BT-31) is missing.',
    });
  } else if (!/^3\d{12}03$/.test(sellerVat)) {
    push({
      code: 'BR-KSA-39',
      category: 'KSA',
      status: 'ERROR',
      message: `Seller VAT "${sellerVat}" must be 15 digits, start with "3", and end with "03".`,
    });
  }

  // BR-KSA-40..42: Postal address completeness
  const postal = findOne(supplier, 'cac:PostalAddress');
  if (!postal) {
    push({
      code: 'BR-KSA-40',
      category: 'KSA',
      status: 'ERROR',
      message: 'Seller postal address (BG-5) is missing.',
    });
  } else {
    const street = findOne(postal, 'cbc:StreetName');
    const city = findOne(postal, 'cbc:CityName');
    const postalZone = findOne(postal, 'cbc:PostalZone');
    const buildingNumber = findOne(postal, 'cbc:BuildingNumber');
    const country = findOne(postal, 'cbc:IdentificationCode');

    if (!street) {
      push({
        code: 'BR-KSA-40',
        category: 'KSA',
        status: 'ERROR',
        message: 'Seller street name is missing.',
      });
    }
    if (!city) {
      push({
        code: 'BR-KSA-40',
        category: 'KSA',
        status: 'ERROR',
        message: 'Seller city name is missing.',
      });
    }
    if (!postalZone) {
      push({
        code: 'BR-KSA-41',
        category: 'KSA',
        status: 'ERROR',
        message: 'Seller postal zone (postal code) is missing.',
      });
    } else if (!/^\d{5}$/.test(postalZone)) {
      push({
        code: 'BR-KSA-41',
        category: 'KSA',
        status: 'ERROR',
        message: `Seller postal zone must be 5 digits; found "${postalZone}".`,
      });
    }
    if (buildingNumber && !/^\d{4}$/.test(buildingNumber)) {
      push({
        code: 'BR-KSA-42',
        category: 'KSA',
        status: 'ERROR',
        message: `Seller building number must be 4 digits; found "${buildingNumber}".`,
      });
    }
    if (country && country !== 'SA') {
      push({
        code: 'BR-KSA-42',
        category: 'KSA',
        status: 'WARNING',
        message: `Seller country is "${country}"; ZATCA invoices are normally issued by SA-domiciled entities.`,
      });
    }
  }
}

// ───────────────────────────────────────────────────────────── buyer

function validateBuyer(
  xml: string,
  type: 'standard' | 'simplified',
  push: (m: ValidationMessage) => void
) {
  const customer = findOne(xml, 'cac:AccountingCustomerParty');
  if (!customer) {
    if (type === 'standard') {
      push({
        code: 'BR-07',
        category: 'CORE',
        status: 'ERROR',
        message: 'AccountingCustomerParty (BG-7) is required for Standard invoices.',
      });
    }
    return;
  }

  const buyerName = findOne(customer, 'cbc:RegistrationName');
  if (!buyerName) {
    push({
      code: type === 'standard' ? 'BR-07' : 'BR-KSA-22',
      category: type === 'standard' ? 'CORE' : 'KSA',
      status: 'ERROR',
      message: 'Buyer name (BT-44) is missing.',
    });
  }

  if (type === 'standard') {
    // BR-KSA-44: Standard invoice must have a buyer identifier (VAT, Group VAT, or other ID)
    const taxScheme = findOne(customer, 'cac:PartyTaxScheme');
    const buyerVat = taxScheme ? findOne(taxScheme, 'cbc:CompanyID') : null;
    const otherId = findOne(customer, 'cac:PartyIdentification');

    if (!buyerVat && !otherId) {
      push({
        code: 'BR-KSA-44',
        category: 'KSA',
        status: 'ERROR',
        message: 'Standard invoices require a buyer VAT number or other identifier.',
      });
    } else if (buyerVat && !/^3\d{12}03$/.test(buyerVat)) {
      push({
        code: 'BR-KSA-39',
        category: 'KSA',
        status: 'ERROR',
        message: `Buyer VAT "${buyerVat}" must be 15 digits, start with "3", and end with "03".`,
      });
    }
  }
}

// ───────────────────────────────────────────────────────────── lines

function validateInvoiceLines(xml: string, push: (m: ValidationMessage) => void) {
  const lines = findAll(xml, 'cac:InvoiceLine');

  if (lines.length === 0) {
    push({
      code: 'BR-16',
      category: 'CORE',
      status: 'ERROR',
      message: 'Invoice must contain at least one invoice line (BG-25).',
    });
    return;
  }

  lines.forEach((line, i) => {
    const idx = i + 1;
    const lineId = findOne(line, 'cbc:ID');
    const qtyAttr = findOneWithAttr(line, 'cbc:InvoicedQuantity');
    const lineExt = findOne(line, 'cbc:LineExtensionAmount');
    const itemName = findOne(line, 'cbc:Name');
    const priceAmount = findOne(line, 'cbc:PriceAmount');

    if (!lineId) {
      push({
        code: 'BR-21',
        category: 'CORE',
        status: 'ERROR',
        message: `Invoice line #${idx} is missing an ID (BT-126).`,
      });
    }
    if (!qtyAttr) {
      push({
        code: 'BR-22',
        category: 'CORE',
        status: 'ERROR',
        message: `Invoice line #${idx} is missing InvoicedQuantity (BT-129).`,
      });
    } else if (!qtyAttr.attrs.unitCode) {
      push({
        code: 'BR-23',
        category: 'CORE',
        status: 'ERROR',
        message: `Invoice line #${idx} is missing the @unitCode attribute on InvoicedQuantity.`,
      });
    }
    if (!itemName) {
      push({
        code: 'BR-24',
        category: 'CORE',
        status: 'ERROR',
        message: `Invoice line #${idx} is missing item name (BT-153).`,
      });
    }
    if (!priceAmount) {
      push({
        code: 'BR-25',
        category: 'CORE',
        status: 'ERROR',
        message: `Invoice line #${idx} is missing PriceAmount (BT-146).`,
      });
    } else {
      const p = num(priceAmount);
      if (p == null) {
        push({
          code: 'BR-25',
          category: 'CORE',
          status: 'ERROR',
          message: `Invoice line #${idx} PriceAmount "${priceAmount}" is not a valid number.`,
        });
      } else if (p <= 0) {
        push({
          code: 'BR-KSA-26',
          category: 'KSA',
          status: 'ERROR',
          message: `Invoice line #${idx} unit price must be greater than zero (found ${p}).`,
        });
      }
      if (decimalsOf(priceAmount) > 6) {
        push({
          code: 'BR-DEC-09',
          category: 'CORE',
          status: 'ERROR',
          message: `Invoice line #${idx} PriceAmount has more than 6 decimal places.`,
        });
      }
    }

    // BR-CO-04: line net = qty × price (within tolerance)
    if (qtyAttr && priceAmount && lineExt) {
      const q = num(qtyAttr.value);
      const p = num(priceAmount);
      const ext = num(lineExt);
      if (q != null && p != null && ext != null) {
        const expected = q * p;
        if (!close(expected, ext, 0.02)) {
          push({
            code: 'BR-CO-04',
            category: 'CORE',
            status: 'ERROR',
            message: `Invoice line #${idx}: LineExtensionAmount ${ext} ≠ quantity (${q}) × unit price (${p}) = ${expected.toFixed(2)}.`,
          });
        }
      }
    }

    // BR-DEC-23: line extension, line tax amount limited to 2 decimals at the document level
    if (lineExt && decimalsOf(lineExt) > 2) {
      push({
        code: 'BR-DEC-23',
        category: 'CORE',
        status: 'ERROR',
        message: `Invoice line #${idx} LineExtensionAmount has more than 2 decimal places.`,
      });
    }
  });
}

// ───────────────────────────────────────────────────────────── VAT breakdown

function validateVatBreakdown(xml: string, push: (m: ValidationMessage) => void) {
  // BR-S-08: VAT category code must be S, Z, E, O, or AE
  const validCategories = new Set(['S', 'Z', 'E', 'O', 'AE']);
  const taxCategoryIds = findAll(xml, 'cac:TaxCategory')
    .map((tc) => findOne(tc, 'cbc:ID'))
    .filter((id): id is string => !!id);

  taxCategoryIds.forEach((id) => {
    if (!validCategories.has(id)) {
      push({
        code: 'BR-S-08',
        category: 'CORE',
        status: 'ERROR',
        message: `VAT category code "${id}" is not one of S/Z/E/O/AE.`,
      });
    }
  });

  // BR-CO-17: TaxAmount per subtotal = TaxableAmount × Percent / 100 (±0.01)
  const subtotals = findAll(xml, 'cac:TaxSubtotal');
  subtotals.forEach((sub, i) => {
    const taxableStr = findOne(sub, 'cbc:TaxableAmount');
    const taxStr = findOne(sub, 'cbc:TaxAmount');
    const percentStr = findOne(sub, 'cbc:Percent');
    const taxable = num(taxableStr);
    const tax = num(taxStr);
    const percent = num(percentStr);

    if (taxable != null && percent != null && tax != null) {
      const expected = (taxable * percent) / 100;
      if (!close(expected, tax)) {
        push({
          code: 'BR-CO-17',
          category: 'CORE',
          status: 'ERROR',
          message: `Tax subtotal #${i + 1}: tax amount ${tax} ≠ taxable ${taxable} × ${percent}% = ${expected.toFixed(2)}.`,
        });
      }
    }
  });

  // BR-Z-02 / BR-E-02: zero-rated and exempt categories must have tax amount = 0
  subtotals.forEach((sub, i) => {
    const cat = findOne(sub, 'cac:TaxCategory');
    if (!cat) return;
    const id = findOne(cat, 'cbc:ID');
    const taxAmt = num(findOne(sub, 'cbc:TaxAmount')) ?? 0;
    if (id === 'Z' && Math.abs(taxAmt) > TOLERANCE) {
      push({
        code: 'BR-Z-02',
        category: 'CORE',
        status: 'ERROR',
        message: `Tax subtotal #${i + 1}: zero-rated (Z) category must have TaxAmount of 0; found ${taxAmt}.`,
      });
    }
    if (id === 'E' && Math.abs(taxAmt) > TOLERANCE) {
      push({
        code: 'BR-E-02',
        category: 'CORE',
        status: 'ERROR',
        message: `Tax subtotal #${i + 1}: exempt (E) category must have TaxAmount of 0; found ${taxAmt}.`,
      });
    }
  });
}

// ───────────────────────────────────────────────────────────── totals

function validateMonetaryTotals(xml: string, push: (m: ValidationMessage) => void) {
  const ltm = findOne(xml, 'cac:LegalMonetaryTotal');
  if (!ltm) {
    push({
      code: 'BR-12',
      category: 'CORE',
      status: 'ERROR',
      message: 'LegalMonetaryTotal (BG-22) is missing.',
    });
    return;
  }

  const lineExt = num(findOne(ltm, 'cbc:LineExtensionAmount'));
  const taxExclusive = num(findOne(ltm, 'cbc:TaxExclusiveAmount'));
  const taxInclusive = num(findOne(ltm, 'cbc:TaxInclusiveAmount'));
  const payable = num(findOne(ltm, 'cbc:PayableAmount'));
  const allowance = num(findOne(ltm, 'cbc:AllowanceTotalAmount')) ?? 0;
  const charge = num(findOne(ltm, 'cbc:ChargeTotalAmount')) ?? 0;
  const prepaid = num(findOne(ltm, 'cbc:PrepaidAmount')) ?? 0;
  const rounding = num(findOne(ltm, 'cbc:PayableRoundingAmount')) ?? 0;

  // BR-KSA-F-04: All required totals must be > 0
  if (taxInclusive != null && taxInclusive <= 0) {
    push({
      code: 'BR-KSA-F-04',
      category: 'KSA',
      status: 'ERROR',
      message: `TaxInclusiveAmount (BT-112) must be greater than zero (found ${taxInclusive}).`,
    });
  }
  if (lineExt != null && lineExt <= 0) {
    push({
      code: 'BR-KSA-F-04',
      category: 'KSA',
      status: 'ERROR',
      message: `LineExtensionAmount (BT-106) must be greater than zero (found ${lineExt}).`,
    });
  }

  // BR-CO-10: LineExtensionAmount = sum of line nets
  const lineExts = findAll(xml, 'cac:InvoiceLine')
    .map((l) => num(findOne(l, 'cbc:LineExtensionAmount')))
    .filter((n): n is number => n != null);
  if (lineExts.length > 0 && lineExt != null) {
    const sum = lineExts.reduce((a, b) => a + b, 0);
    if (!close(sum, lineExt)) {
      push({
        code: 'BR-CO-10',
        category: 'CORE',
        status: 'ERROR',
        message: `LineExtensionAmount ${lineExt} ≠ sum of invoice line nets ${sum.toFixed(2)}.`,
      });
    }
  }

  // BR-CO-13: TaxExclusiveAmount = LineExt - Allowances + Charges
  if (lineExt != null && taxExclusive != null) {
    const expected = lineExt - allowance + charge;
    if (!close(expected, taxExclusive)) {
      push({
        code: 'BR-CO-13',
        category: 'CORE',
        status: 'ERROR',
        message: `TaxExclusiveAmount ${taxExclusive} ≠ LineExt (${lineExt}) - Allowances (${allowance}) + Charges (${charge}) = ${expected.toFixed(2)}.`,
      });
    }
  }

  // BR-CO-15: TaxInclusiveAmount = TaxExclusiveAmount + sum of TaxAmounts
  // We sum the document-level TaxTotal/TaxAmount (the outermost one).
  const taxTotalSection = findOne(xml, 'cac:TaxTotal');
  const totalTax = taxTotalSection ? num(findOne(taxTotalSection, 'cbc:TaxAmount')) : null;
  if (taxExclusive != null && totalTax != null && taxInclusive != null) {
    const expected = taxExclusive + totalTax;
    if (!close(expected, taxInclusive)) {
      push({
        code: 'BR-CO-15',
        category: 'CORE',
        status: 'ERROR',
        message: `TaxInclusiveAmount ${taxInclusive} ≠ TaxExclusive (${taxExclusive}) + TotalTax (${totalTax}) = ${expected.toFixed(2)}.`,
      });
    }
  }

  // BR-CO-16: PayableAmount = TaxInclusiveAmount - Prepaid + Rounding
  if (taxInclusive != null && payable != null) {
    const expected = taxInclusive - prepaid + rounding;
    if (!close(expected, payable)) {
      push({
        code: 'BR-CO-16',
        category: 'CORE',
        status: 'ERROR',
        message: `PayableAmount ${payable} ≠ TaxInclusive (${taxInclusive}) - Prepaid (${prepaid}) + Rounding (${rounding}) = ${expected.toFixed(2)}.`,
      });
    }
  }

  // BR-DEC-* family: monetary totals limited to 2 decimal places
  const checkDec = (label: string, raw: string | null, code: string) => {
    if (raw && decimalsOf(raw) > 2) {
      push({
        code,
        category: 'CORE',
        status: 'ERROR',
        message: `${label} has more than 2 decimal places.`,
      });
    }
  };
  checkDec('LineExtensionAmount', findOne(ltm, 'cbc:LineExtensionAmount'), 'BR-DEC-09');
  checkDec('TaxExclusiveAmount', findOne(ltm, 'cbc:TaxExclusiveAmount'), 'BR-DEC-10');
  checkDec('TaxInclusiveAmount', findOne(ltm, 'cbc:TaxInclusiveAmount'), 'BR-DEC-12');
  checkDec('PayableAmount', findOne(ltm, 'cbc:PayableAmount'), 'BR-DEC-18');
}

// ───────────────────────────────────────────────────────────── QR

function validateQrPresence(xml: string, push: (m: ValidationMessage) => void) {
  // BR-KSA-22 (QR presence): every invoice must carry a QR code in
  // AdditionalDocumentReference with ID = "QR".
  const refs = findAll(xml, 'cac:AdditionalDocumentReference');
  const qrRef = refs.find((r) => /<cbc:ID>QR<\/cbc:ID>/.test(r));
  if (!qrRef) {
    push({
      code: 'BR-KSA-22',
      category: 'KSA',
      status: 'ERROR',
      message: 'Mandatory QR code (KSA-14) is missing from the invoice.',
    });
    return;
  }

  const qrPayload = findOne(qrRef, 'cbc:EmbeddedDocumentBinaryObject');
  if (!qrPayload || qrPayload === 'QR_BASE64_PLACEHOLDER') {
    push({
      code: 'BR-KSA-22',
      category: 'KSA',
      status: 'ERROR',
      message: 'QR code payload is empty or still a placeholder; signing/QR step did not complete.',
    });
  } else if (!/^[A-Za-z0-9+/=]+$/.test(qrPayload)) {
    push({
      code: 'BR-KSA-22',
      category: 'KSA',
      status: 'ERROR',
      message: 'QR code payload is not valid base64.',
    });
  }
}
