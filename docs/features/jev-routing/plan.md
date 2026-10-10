# Implementation and verification

- Add a host-only Jev client using the official `systemone` request and choice-answer contract. Keep the key in the host environment and inject transport/planner functions for tests.
- Build a shortlist from the current Claude or Codex model catalog. Run a read-only planner only when Jev requests one, then ask Jev to pick a shortlisted execution model.
- Integrate routing in `pty:start` command assembly and retain the chosen model for resumes. Preserve explicit card model choices. Display route and fallback status on the board and workspace panel.
- Add host-only key management through Settings with a separate local file and status-only reads; allow an environment variable as fallback and apply changes without host restart.
- Cover the two Jev decisions, no-plan path, malformed choices, and core launch integration. Run both typechecks, `npm test`, Web UI build, E2E, and a live Web UI check with a temporary store.
- Exercise the real planner process path for both agent CLIs on POSIX using a fake executable in a directory with spaces; assert arguments, worktree, and stdin. Exercise key storage under a macOS-style `Library/Application Support` path. The existing CI `macos-latest` test job runs these checks.
