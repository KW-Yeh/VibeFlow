# Prep: investigation

The night answers a question and writes a report; it opens no PR.

## Checklist

- [ ] The question, phrased so the answer can be checked ("why does X happen when Y", "how big is
      the impact of Z"), and what decision the answer feeds.
- [ ] Where to look: repos, logs, dashboards, data the night can reach from this machine
      (check access, pass / fail).
- [ ] The form of the answer: a report in `$VIBEFLOW_ARTIFACTS_DIR`, with evidence, and options
      if a fix follows.
- [ ] What it must not do: change code, open PRs, write to external systems.

## Required on the sheet

驗收條件: the report exists and answers the question with evidence. Tell the night to set the
card's status with the report's path as the reason (`needs_review`), since there is no PR.
