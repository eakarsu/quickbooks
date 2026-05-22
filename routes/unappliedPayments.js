const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    success: true,
    feature: 'Unapplied Payments',
    summary: { unappliedTotal: 18420, customersImpacted: 6, oldestDays: 42, autoMatchCandidates: 4 },
    payments: [
      { customer: 'Aster Supply', amount: 4200, received: '2026-05-02', candidateInvoice: 'INV-1042', confidence: 0.92 },
      { customer: 'Blue Ridge Cafe', amount: 3100, received: '2026-05-09', candidateInvoice: 'INV-1057', confidence: 0.84 },
      { customer: 'Cedar Design', amount: 7800, received: '2026-04-10', candidateInvoice: 'INV-0998', confidence: 0.78 },
    ],
    actions: [
      'Match same-customer payments to open invoices within amount tolerance.',
      'Escalate unapplied cash older than 30 days to AR review.',
      'Export suggested matches before posting QuickBooks payment links.',
    ],
  });
});

module.exports = router;
