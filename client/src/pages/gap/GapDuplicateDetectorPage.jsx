// === Batch 11 Gaps & Frontend Mounts ===
import GapFeaturePage from '../../components/GapFeaturePage'
export default function GapDuplicateDetectorPage() {
  return (
    <GapFeaturePage
      title="Duplicate Detector"
      description="Duplicate Detector"
      slug="duplicate-detector"
      aiResultKey="duplicates"
      fields={[
  {
    "name": "records",
    "label": "Records (JSON array)",
    "type": "json"
  }
]}
    />
  )
}
