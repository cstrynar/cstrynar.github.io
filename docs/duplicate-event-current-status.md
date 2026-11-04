# New event: create from scratch or duplicate a past event

Updated November 4, 2026 for Connor. Candidate based on production/main
06a087bec8ee0d8e5b403df579219538ab26d068. Not deployed.

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

## Remaining release checks

No production data, schema, endpoint, grants or frontend changed. No actual event
was created. The previously supplied PostgreSQL/Edge/Storage tests have NOT been
rerun here: this runtime has no PostgreSQL/psql, and no isolated hosted Mercury
target is available. The browser test file has been adapted to the new entry flow
but its complete automated suite has not run; manual browser checks above are
not a substitute for backend or all-browser-suite acceptance.

Before merge/release: use a separate authorized Mercury staging environment,
reconcile the fixture schema against real constraints/triggers, test new display
and team fields plus inherited race/award behavior, run transaction/retry/auth/
logo tests, and verify private duplicates are excluded from public APIs. Deploy
migration, endpoint and frontend in that order only after passing those checks.
Do not use the production database for fixture testing. The older rollout and
staging-review documents remain historical evidence, not current test results.
