// === Batch 11 Gaps & Frontend Mounts ===
import GapFeaturePage from '../../components/GapFeaturePage'
export default function GapBankSyncPlaidPage() {
  return (
    <GapFeaturePage
      title="Bank Sync (Plaid)"
      description="Bank Sync (Plaid)"
      slug="bank-sync-plaid"
      aiResultKey="syncJob"
      fields={[
  {
    "name": "institutionId",
    "label": "Institution ID",
    "required": true,
    "placeholder": ""
  },
  {
    "name": "accountId",
    "label": "Account ID",
    "required": false,
    "placeholder": ""
  }
]}
    />
  )
}
