// === Batch 11 Gaps & Frontend Mounts ===
import GapFeaturePage from '../../components/GapFeaturePage'
export default function GapReconciliationPage() {
  return (
    <GapFeaturePage
      title="Bank Sync & Reconciliation Agent"
      description="Bank Sync & Reconciliation Agent"
      slug="reconciliation"
      aiResultKey="matches"
      fields={[
  {
    "name": "bankTxns",
    "label": "Bank Transactions (JSON)",
    "type": "json"
  },
  {
    "name": "bookTxns",
    "label": "Book Transactions (JSON)",
    "type": "json"
  }
]}
    />
  )
}
