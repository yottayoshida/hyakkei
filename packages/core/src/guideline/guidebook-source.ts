/**
 * The guidebook source used for recorded conformance claims.
 *
 * This is deliberately a dated, immutable publisher record rather than a
 * runtime fetch or content hash. The publisher's `v02` label identifies the
 * edition used by Hyakkei; the retrieval and Last-Modified dates make source
 * drift auditable when the publisher serves changed bytes at the same URL.
 */
export const GUIDEBOOK_SOURCE = Object.freeze({
  version: "v02",
  pdfUrl:
    "https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/1948e3cd-736a-4378-9e31-039b08d11106/2a3a0ebc/20260331_resources_dashboard-guidebook_guidebook_02.pdf",
  retrievedAt: "2026-08-02",
  sourceLastModified: "2026-07-17",
} as const);
