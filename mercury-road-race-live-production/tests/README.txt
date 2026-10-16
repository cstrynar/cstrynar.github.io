Mercury R26 offline frontend regressions

Run from the repository root with Node 22+ and Google Chrome installed:
  node mercury-road-race-live-production/tests/regressions.cjs

Optional environment variables:
  CHROME=/absolute/path/to/chrome
  SOURCE_REF=2094abf44e63a6342f1ee7ecdd0c2f3145ef3ffb
  QA_OUTPUT=/absolute/path/to/screenshots

SOURCE_REF loads the same production functions and HTML from that Git revision.
This makes before/after tests deterministic without modifying the working tree.
The harness uses a temporary Chrome profile, removes page scripts before loading
markup, then executes the selected production functions with mocked data and
controlled deferred promises. HTTP and HTTPS requests are blocked before page
navigation. No backend, authentication, production data, clocks or race lifecycle
actions are exercised. Chrome's DevTools endpoint is local to the test process.

Semantics: the public overallAwardPlaces function already uses nullish default 3.
Admin now displays null/missing as blank with a Default (3) placeholder; a cleared
field saves null (default Top 3), while explicit 0 disables overall awards.
Explicit 1/3/20 and other valid integers remain explicit. The frontend settings
payload carries the collected awards directly; backend behavior is not changed.

Age-group rows retain their loaded division set, including single-gender rows.
The existing bulk switch rewrites row scopes only when explicitly changed.
New rows follow the switch; standard groups explicitly restore both genders.
Per-row scope text makes the retained configuration visible.

Validation on 2026-10-16:
  Baseline 2094abf44e63a6342f1ee7ecdd0c2f3145ef3ffb: 6/14 pass, 8 fail.
  Fixed working tree: 14/14 pass.
  All inline scripts compile with node:vm.Script; git diff --check passes.
  Mocked awards screenshot QA at 1440px and 390px: no horizontal overflow;
  Male/Female row scope and Default (3) text visible.

Independent code review: separate review agent inspected both HTML diffs and the
expanded tests; no blocking findings. Its Chrome startup was unavailable, so its
review was static. Primary browser execution supplied the test evidence.

Limits: these are focused production-function/DOM tests, not an authenticated
end-to-end backend save test. Existing same-race response ordering (including
5K -> 10K -> 5K) is not solved by race identity guards. Upcoming/Past, Duplicate
Event and Delete/Archive redesign remain paused and unchanged.
