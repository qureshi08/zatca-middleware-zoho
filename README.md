# 🏦 ZATCA-middleware-zoho

[![ZATCA Phase 2](https://img.shields.io/badge/ZATCA-Phase%202--Compliant-blue)](https://zatca.gov.sa/)
[![Status](https://img.shields.io/badge/Status-Production--Ready-green)]()

The **ZATCA-middleware-zoho** is a production-grade integration hub for Zoho Books ZATCA (FATOORA) compliance. It handles the complete onboarding lifecycle, cryptographic signing, and UBL 2.1 XML generation for Phase 2.

Integration with Zoho Books uses the **Zoho Books v3 REST API** over **OAuth2**. Invoices and credit notes are pulled by a workflow webhook, cleared/reported with ZATCA, and the UUID, QR code and signed PDF are written back to the document as custom fields, a timeline comment, and a file attachment.

---

## 📖 Supporting Documentation

We have provided comprehensive manuals for different stakeholders:

*   [**🚨 Project Hand-off**](./docs/PROJECT_HANDOFF.md) - **Start Here!** Full project context, critical fixes, and roadmap.
*   [**User Manual**](./docs/USER_MANUAL.md) - Documentation for operations and finance teams on onboarding and status handling.
*   [**Developer Manual**](./docs/DEVELOPER_MANUAL.md) - Deep technical breakdown of crypto, architecture, and API specs.
*   [**C4 Architecture Model**](./docs/C4_ARCHITECTURE.md) - System context, container, and component diagrams.
*   [**Exhaustive Test Cases**](./docs/TEST_CASES.md) - Complete list of technical and business scenarios for validation.

---

## 🔥 Key Technical Features

- **Automated Workflow**: Full lifecycle implementation from identity generation to production clearance.
- **API Coverage**: 100% implementation of Core APIs (Compliance, Production, Clearance, Reporting, and Renewal).
- **Strict Compliance**: Zero-drift hashing and signing matching ZATCA ISB 2.1 specifications.
- **Enterprise Ready**: Designed for Bank of Jordan's isolated infrastructure with robust logging and audit trails.

---

## 💻 Quick Start

### 1. Installation
Navigate to the application directory and install dependencies:
```bash
cd zatca-einvoicing
npm install
```

### 2. Run Locally
Start the development server:
```bash
npm run dev
```

---

## 📁 System Architecture

The core integration logic is organized under `src/lib/zatca/`:
- **Crypto**: ECDSA secp256k1 signing and SHA-256 hashing.
- **XML**: UBL 2.1 templates for Invoices and Credit/Debit Notes.
- **API**: Clients for ZATCA Compliance, Clearance, and Reporting services.

---

## ⚖️ Governance
Internal Use Only (**Bank of Jordan Compliance**).  
© 2026. All rights reserved.
