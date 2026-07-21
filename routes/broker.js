const express = require('express');
const { authenticateToken, getDb } = require('../middleware/auth');
const { authorize, requireRole } = require('../middleware/rbac');
const { GovernedBrokerService } = require('../services/GovernedBrokerService');

const router = express.Router();

function useService(handler) {
  return async (req, res, next) => {
    const db = getDb();
    const service = new GovernedBrokerService(db);
    try {
      await handler(service, req, res);
      db.close();
    } catch (error) {
      db.close();
      next(error);
    }
  };
}

router.post('/webhooks/:providerCode', useService(async (service, req, res) => {
  const result = await service.ingestSignedEvent(req.params.providerCode, {
    rawBody: req.rawBody || JSON.stringify(req.body),
    timestamp: req.get('x-provider-timestamp'),
    signature: req.get('x-provider-signature'),
    providerHost: req.get('x-provider-host'),
  });
  res.status(result.quarantined ? 202 : 200).json({ success: !result.quarantined, ...result });
}));

router.use(authenticateToken);

router.get('/operations', authorize('read'), useService(async (service, _req, res) => {
  res.json({ success: true, data: await service.getOperationsSnapshot() });
}));

router.post('/providers', authorize('manage_broker'), useService(async (service, req, res) => {
  res.status(201).json({ success: true, data: await service.createProvider(req.body, req.user) });
}));

router.post('/accounts', authorize('manage_broker'), useService(async (service, req, res) => {
  res.status(201).json({ success: true, data: await service.createCustodyAccount(req.body, req.user) });
}));

router.post('/instruments', authorize('manage_broker'), useService(async (service, req, res) => {
  res.status(201).json({ success: true, data: await service.createInstrument(req.body, req.user) });
}));

router.post('/accounts/:id/kill-switch', requireRole('admin', 'manager'), useService(async (service, req, res) => {
  res.json({ success: true, data: await service.setKillSwitch(req.params.id, req.body, req.user) });
}));

router.post('/orders', authorize('paper_trade'), useService(async (service, req, res) => {
  res.status(201).json({ success: true, data: await service.submitOrder(req.body, req.user) });
}));

router.post('/orders/:id/approve', authorize('approve_orders'), useService(async (service, req, res) => {
  res.json({ success: true, data: await service.approveOrder(req.params.id, req.body, req.user) });
}));

router.post('/fills/:id/correct', authorize('correct_ledger'), useService(async (service, req, res) => {
  res.status(201).json({ success: true, data: await service.correctFill(req.params.id, req.body, req.user) });
}));

router.post('/scenarios', authorize('approve_orders'), useService(async (service, req, res) => {
  const data = await service.runScenario(req.body, req.user);
  res.status(data.status === 'PASSED' ? 201 : 422).json({ success: data.status === 'PASSED', data });
}));

router.get('/audit-export', authorize('export'), useService(async (service, _req, res) => {
  const data = await service.exportAudit();
  res.set('content-type', 'application/json; charset=utf-8');
  res.set('content-disposition', `attachment; filename="paper-ledger-audit-${data.exportedAt.slice(0, 10)}.json"`);
  res.send(JSON.stringify(data));
}));

router.all('/live-orders{*path}', (_req, res) => res.status(403).json({ error: 'Live execution is outside this product boundary', code: 'LIVE_EXECUTION_FORBIDDEN' }));

module.exports = router;
