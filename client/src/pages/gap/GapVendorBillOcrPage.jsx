// === Batch 11 Gaps & Frontend Mounts ===
import GapFeaturePage from '../../components/GapFeaturePage'
export default function GapVendorBillOcrPage() {
  return (
    <GapFeaturePage
      title="Vendor Bill OCR"
      description="Vendor Bill OCR"
      slug="vendor-bill-ocr"
      aiResultKey="extraction"
      fields={[
  {
    "name": "billText",
    "label": "Bill Text",
    "type": "textarea",
    "rows": 4,
    "required": true
  }
]}
    />
  )
}
