// === Batch 11 Gaps & Frontend Mounts ===
import GapFeaturePage from '../../components/GapFeaturePage'
export default function GapFinancialStatementsPage() {
  return (
    <GapFeaturePage
      title="Financial Statements Report"
      description="Financial Statements Report"
      slug="financial-statements"
      aiResultKey="report"
      fields={[
  {
    "name": "period",
    "label": "Period",
    "required": true,
    "placeholder": ""
  },
  {
    "name": "type",
    "label": "Type (P&L/BS/CF)",
    "required": false,
    "placeholder": ""
  }
]}
    />
  )
}
