# Operator dashboard V1 — November 4, 2026

Read-only Operator dashboard tab in Mercury Admin. Queries existing authenticated
event/settings and Bridge-access endpoints. Shows selected identity, lifecycle and
visibility, authorized publishing computers, unexpired writer lease, latest saved
publication/revision and actionable cloud-state alerts. Refreshes every 30 seconds
only while visible; manual refresh does not reload or overwrite settings forms.

Dedicated Bridge heartbeat, local MYLAPS export age/readability, pending queue,
paused/rejected work and end-to-end public verification are not available through
these reads. The first three are displayed as Not reported, with instructions to
check the timing computer. Prior last-used timestamps are not connection evidence.
Lease ownership is not proof that uploads are occurring. Old result timestamps
alone never trigger an offline diagnosis.

Selection/session generations and abort controllers discard stale responses.
Timeout/failure clears old status instead of retaining a healthy display. Two
reads must agree on event ID/slug, status and revision before rendering. Refresh
does not modify participant data, source exports, grants or Bridge installation.

Next integration work: inspect the actual installed Bridge transport before
designing a heartbeat/status report carrying event-scoped source freshness,
queue/hold state and sanitized errors. Do not invent these signals from leases
or successful past uploads. Such integration needs separate implementation and
targeted validation; V1 does not claim it exists.

Validation: six model tests cover unknown telemetry, lease expiry, closed-event
access, inactive credentials/grants, private/mapping alerts and invalid timestamps;
existing event-history/closeout/duplication/deletion checks remain applicable.

## Cloud race summary — November 4

The dashboard now summarizes detected race identities and race-labeled row counts
from the saved revision, using the existing authenticated mapping response. Counts
are explicitly not finisher/participant totals and exclude rows without race labels.
Each identity is marked recognized or mapping required. Empty, malformed, duplicate
or inconsistent reports remain Not confirmed; the existing API can return empty
detection after a snapshot-read failure, so empty never means zero results.
No backend, Bridge, publishing or event-data changes are required.
