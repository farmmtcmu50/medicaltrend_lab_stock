# QR scan D1 optimization

The scanner now updates the affected available-stock row using the canonical barcode and remaining quantity returned by the consume API. Dashboard, purchase suggestions, QR reprints, reports and settings/audit are marked dirty and refreshed when opened, rather than after each successful scan. Server-side FEFO validation remains in both preview and consume to detect changes between requests.

Migration 0005 mirrors the six production indexes installed on 17 October 2026, removes the two covered legacy indexes, and adds expression indexes matching case-insensitive barcode lookups and composite indexes for FEFO and package-child queries. Index creation scans existing data once and adds index maintenance on subsequent writes. It does not remove stock data.

Validation: `TMPDIR=/private/tmp node --test tests/*.test.mjs` (12 cases), including partial packages, child QR removal, case-insensitive QR lookup, FEFO refusal/override and deferred UI refresh. A local D1 database with 10,000 historical rows verifies SEARCH using idx_su_barcode_lower instead of SCAN. Local Miniflare reports zero rows_read, so no production reduction percentage is claimed.

Deploy migration before the Worker/assets for each stock database. Existing open browser tabs should reload after deployment. Legacy: apply migrations with wrangler.jsonc, then deploy. Subscription tenants: `node scripts/subscription.mjs update <slug>` applies migrations and deploys to the isolated tenant. The central subscription Worker does not need updating.

Production verification should compare D1 metrics before/after during normal scans; do not consume real inventory just to benchmark.
