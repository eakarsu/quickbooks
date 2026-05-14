// === Batch 11 Gaps & Frontend Mounts ===
import GapFeaturePage from '../../components/GapFeaturePage'
export default function GapForecastingPage() {
  return (
    <GapFeaturePage
      title="Financial Forecasting"
      description="Financial Forecasting"
      slug="forecasting"
      aiResultKey="forecast"
      fields={[
  {
    "name": "arAging",
    "label": "AR Aging (JSON)",
    "type": "json"
  },
  {
    "name": "apAging",
    "label": "AP Aging (JSON)",
    "type": "json"
  }
]}
    />
  )
}
