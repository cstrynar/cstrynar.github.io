# Bridge status reporting

The operator dashboard reads an isolated `bridge-status` API. Reporting does not publish results, acquire or renew leases, change event revisions, or edit the local durable publishing queue.

The private `bridge_status_reports` table holds at most eight session observations per event/computer. Reports require an active Bridge credential and active read grant; the database checks both again during the write. Admin reads require the existing Mercury Admin session or eligible legacy key. Direct anonymous/authenticated database and RPC access is denied. Event and computer deletion cascade to their reports. Per-session sequence numbers prevent delayed reports replacing newer observations.

The desktop 0.3.4-rc1 candidate supplies copies from the publishing loop to a separate worker with a latest-only queue. It attempts at most one report per 15 seconds, plus a final paused/blocked report; each network attempt is limited to three seconds. A stalled loop does not generate heartbeats. Failure is discarded and never changes publisher decisions. States are starting, armed, watching, source_wait, upload_delayed, blocked, and paused. Source age is the oldest selected export age; pending/staged/correction are booleans, not counts. No participant data, paths, arbitrary errors, or credentials are stored in telemetry.

Dashboard observations become stale after 120 seconds. Multiple recently reported sessions are shown explicitly. Missing, invalid, revoked and stale reports do not establish health. Export age is advisory, not proof of readability. Browser status failure leaves other cloud checks available. The existing rc4 executable cannot send these reports; an installed candidate and an operator-started session are required. Before a session starts, and after long pauses, status remains unknown/stale.

## Verification and rollout

- Go test suite with race detection passed; Windows amd64 GUI cross-build succeeded.
- 19 Node tests cover existing dashboard checks, telemetry freshness/permissions, endpoint authentication, strict payload validation, oversized bodies and sequence handling.
- Production SQL transaction (rolled back) verified grant requirement, revoked grant rejection, old-sequence rejection, pending-state preservation and event deletion cascade.
- Production permissions verified: no anonymous table read, authenticated table write, or anonymous RPC execute. Security advisor reports intentional RLS-without-policy for this service-only table.
- Unsigned Windows candidate requires signing on HyTek and Windows acceptance before replacing signed rc4. Linux tests and cross-build are not Windows execution evidence.

Rollback: revert dashboard changes or stop the new reporter by returning to signed rc4. The optional reporting endpoint/table may remain unused. Do not roll back result data or alter leases to disable telemetry.
