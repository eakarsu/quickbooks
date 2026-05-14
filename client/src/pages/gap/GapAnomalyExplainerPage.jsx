// === Batch 11 Gaps & Frontend Mounts ===
import GapFeaturePage from '../../components/GapFeaturePage'
export default function GapAnomalyExplainerPage() {
  return (
    <GapFeaturePage
      title="Anomaly Explainer"
      description="Anomaly Explainer"
      slug="anomaly-explainer"
      aiResultKey="explanation"
      fields={[
  {
    "name": "transaction",
    "label": "Transaction (JSON)",
    "type": "json"
  }
]}
    />
  )
}
