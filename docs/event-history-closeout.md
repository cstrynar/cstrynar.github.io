# Event History & Closeout — November 4, 2026

Public results now offer Current / Upcoming, Past Results and All events, plus
name/year filtering. Completed/official/archived events are historical regardless
of date. Past results sort newest first, undated last. Direct event links still
validate against the full public catalog; browsing filters do not change the
currently displayed event or grant access to private records. Public demos retain
their existing visibility and are labeled Demo / rehearsal.

Admin has an expandable history table with Manage controls and a selected-event
summary showing saved status, visibility, last publication, revision, writer
lease and enabled publishing access. Access failures display unknown/unavailable,
never a successful closeout. It is a read-only summary using existing controls;
no status, visibility or grant is changed automatically. Publication timestamps
are explicitly not heartbeat evidence. Save refreshes the summary/access state.

Permanent deletion now removes candidates, state and audit from the separate
archive store in the event deletion transaction. Archive commands and deletion
share the archive lock. Immutable archive triggers allow DELETE only while the
matching live event and confirmed deletion receipt coexist; ordinary edits and
unconfirmed deletion remain blocked. No existing records were deleted at rollout.

Validation: 20 Node tests pass (history ordering/search, closeout state and
unknown handling, previous new-event and deletion contracts), JavaScript syntax
and whitespace checks, manual browser checks of name filtering/newest-first
listing/admin Manage and summary. Service-role database assertions create only
synthetic records inside a rolled-back transaction, verify archive cleanup,
unrelated source preservation, immutability, name/session checks, duplicate retry
and prevention of resurrection. No full historical browser suite or Windows
Bridge rehearsal was run; no Bridge publishing code changed.
