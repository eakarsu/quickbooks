// === Batch 11 Gaps & Frontend Mounts ===
import GapReconciliationPage from './pages/gap/GapReconciliationPage'
import GapTaxCategorizerPage from './pages/gap/GapTaxCategorizerPage'
import GapForecastingPage from './pages/gap/GapForecastingPage'
import GapDuplicateDetectorPage from './pages/gap/GapDuplicateDetectorPage'
import GapVendorBillOcrPage from './pages/gap/GapVendorBillOcrPage'
import GapAnomalyExplainerPage from './pages/gap/GapAnomalyExplainerPage'
import GapBankSyncPlaidPage from './pages/gap/GapBankSyncPlaidPage'
import GapMultiCurrencyPage from './pages/gap/GapMultiCurrencyPage'
import GapAuditTrailPage from './pages/gap/GapAuditTrailPage'
import GapFinancialStatementsPage from './pages/gap/GapFinancialStatementsPage'
import GapPublicApiPage from './pages/gap/GapPublicApiPage'
import GapMobileAppPage from './pages/gap/GapMobileAppPage'
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Transactions from './pages/Transactions';
import Customers from './pages/Customers';
import Invoices from './pages/Invoices';
import Vendors from './pages/Vendors';
import Expenses from './pages/Expenses';
import Products from './pages/Products';
import Accounts from './pages/Accounts';
import AITools from './pages/AITools';
import UnappliedPayments from './pages/UnappliedPayments';

import CodexCustomVizFeature from './pages/CodexCustomVizFeature';
import CodexOperationsFeature from './pages/CodexOperationsFeature';

import TimelineView from './pages/TimelineView';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/insights/timeline" element={<TimelineView />} />
        <Route path="/codex/custom-viz" element={<CodexCustomVizFeature />} />
        <Route path="/codex/operations" element={<CodexOperationsFeature />} />

        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/*" element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/invoices" element={<Invoices />} />
                <Route path="/vendors" element={<Vendors />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/products" element={<Products />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/ai-tools" element={<AITools />} />
                <Route path="/unapplied-payments" element={<UnappliedPayments />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        } />
            {/* === Batch 11 Gaps & Frontend Mounts === */}
        <Route path="/gap/reconciliation" element={<GapReconciliationPage />} />
        <Route path="/gap/tax-categorizer" element={<GapTaxCategorizerPage />} />
        <Route path="/gap/forecasting" element={<GapForecastingPage />} />
        <Route path="/gap/duplicate-detector" element={<GapDuplicateDetectorPage />} />
        <Route path="/gap/vendor-bill-ocr" element={<GapVendorBillOcrPage />} />
        <Route path="/gap/anomaly-explainer" element={<GapAnomalyExplainerPage />} />
        <Route path="/gap/bank-sync-plaid" element={<GapBankSyncPlaidPage />} />
        <Route path="/gap/multi-currency" element={<GapMultiCurrencyPage />} />
        <Route path="/gap/audit-trail" element={<GapAuditTrailPage />} />
        <Route path="/gap/financial-statements" element={<GapFinancialStatementsPage />} />
        <Route path="/gap/public-api" element={<GapPublicApiPage />} />
        <Route path="/gap/mobile-app" element={<GapMobileAppPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
