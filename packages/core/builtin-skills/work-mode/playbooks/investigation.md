# Playbook: investigation

Read only. The result is an answer with evidence, not a code change.

## Steps

1. Rephrase the question so evidence can answer it — "under which conditions does X happen", not "X is weird".
2. List two or three candidate answers and, for each, the evidence you would see if it were true.
3. Collect evidence: code (with `file:line`), git log and PR discussion, logs, transcripts, real run output. Start with whatever best tells the candidates apart.
4. Answer: the conclusion, the evidence for it, which candidates were ruled out and on what grounds, and what is still uncertain. Keep observed facts apart from inferences.
5. If the answer calls for a change, say what should change. If the task already allowed changes ("fix it if you can"), switch straight away; otherwise ask first. Switch to the bug-fix, feature or refactor playbook and start its spec.md and plan.md there.

## Don't

- Modify files or settings in the repo while investigating. Temporary scripts go in a scratch location and are removed at the end.
- Infer runtime behaviour from reading code alone without running it; if it cannot be run, say plainly that it is an inference.
