import type { DocumentSchema } from '../PDF_Algorithm';

import { ClearanceSchema } from './Clearance_Schema';
import { IndigencySchema } from './Indigency_Schema';
import { ResidencySchema } from './Residency_Schema';
import { JobseekerSchema } from './Jobseeker_Schema';
import { AffidavitSchema } from './Affidavit_Schema';

// ═══════════════════════════════════════════════════════════════════════════
// 🗂️ DOCUMENT REGISTRY — the ONE place that lists the available documents.
// ───────────────────────────────────────────────────────────────────────────
// Everything downstream (the type dropdown, the default fee, the schema router,
// which sidebar fields show) is derived from each schema's own `meta`. To add a
// new document you create its schema file and drop it in this array — no shared
// switch statements, fee maps, or field lists to keep in sync. That's the
// isolation guarantee: each document fully describes itself.
// ═══════════════════════════════════════════════════════════════════════════
export const DOCUMENT_SCHEMAS: DocumentSchema[] = [
  ClearanceSchema,
  IndigencySchema,
  ResidencySchema,
  JobseekerSchema,
  AffidavitSchema,
];

// The first schema is the safe fallback when an id can't be matched.
const FALLBACK = DOCUMENT_SCHEMAS[0];

/** Resolve a schema by its canonical `meta.id` (falls back to the first document). */
export const getSchemaById = (id: string | undefined | null): DocumentSchema => {
  if (!id) return FALLBACK;
  return DOCUMENT_SCHEMAS.find(s => s.meta?.id === id) || FALLBACK;
};

/** [{ id, label }] for building the document-type picker. */
export const DOCUMENT_OPTIONS = DOCUMENT_SCHEMAS.map(s => ({
  id: s.meta?.id || '',
  label: s.meta?.label || s.meta?.id || '',
}));

/** id → default fee, derived from each schema's own meta (no separate fee map). */
export const FEE_BY_TYPE: Record<string, string> = Object.fromEntries(
  DOCUMENT_SCHEMAS.filter(s => s.meta).map(s => [s.meta!.id, s.meta!.fee]),
);
