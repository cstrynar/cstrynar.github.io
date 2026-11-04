# New event: create from scratch or duplicate a past event

Updated November 4, 2026 for Connor. Candidate based on production/main
06a087bec8ee0d8e5b403df579219538ab26d068. Connor explicitly authorized production
activation without a separate hosted test environment, and requested permanent
event deletion for tests and cancelled events.

## Behavior

New event opens a choice: Create from scratch or Duplicate a past event.
The duplicate dropdown uses the complete authenticated event catalog, follows
existing Past / Archived classification, and sorts by event date descending,
then name and slug. Undated archived records appear last. No source is selected
by default. The current event selector does not determine the duplication source.
Empty lists explain that an event can be created from scratch.

The October 18-19 implementation was recovered from duplicate-event.patch and
integrated without overwriting the later MYLAPS connection or admin changes.
The existing two-step configuration review, private event creation, immutable
operation ID, status reconciliation, independent logo copy, and no-results/no-grants
contract remain in place. Pending operations reopen through New event before
another duplicate can be started. Scheduled starts are not inherited by default.

Current display columns (entries, grade and podium configuration) and team rule
fields have been added to the original SQL allowlist after read-only production
column inspection. Invalid copied podium race references fail validation.
Course records are deliberately not copied and this is explicit in review.

## Validation performed this session

- Six Node tests pass: past/archive classification and descending order, stable
  tie ordering, no source catalog mutation, literal option text, explicit source
  selection, empty state, stale/ineligible source rejection, pending recovery,
  and inline/external JavaScript syntax.
- Cloud browser with synthetic fetch responses: New event choices, descending
  dropdown, source selection when no current event is selected, two-race copy,
  review with 20 age-group division rows, and Create from scratch blank form.
- git diff --check passes.

## Production rollout and deletion

The additive duplication and deletion migrations are applied. Dedicated
admin-duplicate-event and admin-delete-event endpoints are active and return
401 for unauthenticated calls. Both authenticate existing opaque admin sessions;
RPC execution and operation/deletion records are restricted to service_role.

Delete event requires typing the exact saved name. It deletes the selected
immutable event ID, cascades results, finishers, entries, settings, races,
activity, Bridge grants and leases, and clears historical archive grants.
Other events and copies remain independent. Old duplication requests are
cancelled to prevent resurrection. Pending duplications must be resolved first.
A private deletion receipt retains the event ID, confirmation name and admin
for safe retries; no results or participant data are retained in that receipt.
Storage cleanup uses the Storage API; a durable pending receipt enables retry
if asset cleanup fails. Shared logos referenced by another event are preserved.

Validation: 12 Node tests pass (new-event choices plus deletion endpoint auth,
confirmation errors, asset cleanup, cleanup failure, idempotent retry). Browser
checks confirm the deletion dialog requires the exact name before enabling its
button. Transactional SQL tests ran with service_role on synthetic records and
rolled back every fixture: duplicate reserve/commit/private defaults, pending
source protection, unauthorized/wrong-name rejection, result/finisher/settings/
race/policy/activity cascade, original preservation, deletion retry and no
resurrection. All 19 preexisting live_events rows have an unchanged full-row hash;
no deletion receipts or duplicate operations remained after assertions.

The full historical PostgreSQL/Edge/Storage fixture suite has not been rerun.
Actual signed-in production creation/logo-copy/deletion acceptance is Connor's
next step. No paid staging environment was provisioned. The October rollout
and staging-review documents are historical, superseded by this authorization.
