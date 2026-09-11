# Taylor Portal v3.3.1 verification

This release retains the v3.3.0 admin dropdown and delegated invitation endpoint, and adds confirmation-gated task creation/updates for typed chat and Realtime Voice. Other project tools delegate to their existing implementations.

The old portal context serialized all chapters and then cut the JSON at 70,000 characters. Voice tried to parse that incomplete JSON before contacting the tasks service. The replacement builds a bounded summary before serialization and reads tasks from the live tool.

Run from this directory:

```sh
node --test task-workflow.test.cjs
python task-workflow-browser-tests.py
```

The browser suite requires Python Playwright and a Chromium executable at `/usr/bin/chromium`; adjust the executable path for another environment. Browser requests are simulated. These tests do not sign in to production, run real microphone/model sessions, send invitations, or change real tasks. The fixture provides the portal globals and dropdown contract used by the workflow extension.

Results at release: 20 unit tests and 14 mock-backed Chromium tests passed. Coverage includes complete JSON with long chapters; broad, filtered and empty reads; special characters; malformed/HTML responses; admin eligibility; typed and voice task creation; cancellation; new-turn-only voice confirmation; duplicate tool calls; stale-task rejection; deactivated assignees; retained project tool delegation; and preserving Blocked status in the editor.
