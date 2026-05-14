// === Batch 11 Gaps & Frontend Mounts ===
import GapFeaturePage from '../../components/GapFeaturePage'
export default function GapTaxCategorizerPage() {
  return (
    <GapFeaturePage
      title="Expense Tax Categorizer"
      description="Expense Tax Categorizer"
      slug="tax-categorizer"
      aiResultKey="category"
      fields={[
  {
    "name": "description",
    "label": "Description",
    "required": true,
    "placeholder": ""
  },
  {
    "name": "amount",
    "label": "Amount",
    "type": "number"
  }
]}
    />
  )
}
