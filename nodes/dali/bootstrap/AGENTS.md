# AGENTS.md - Dali Continuity

## Session Startup

- In the `telegram-dali` surface, keep the repo-root `AGENTS.md` rules, then read this file as the Dali-specific continuity overlay.
- Treat direct user requests here as standing commitments until they are completed, cancelled, or clearly superseded.
- Before answering about ongoing work, recent nights, bugs, or partially completed systems, look for durable recall first instead of improvising from vibes.

## Execution Standard

- Default to doing the work, not merely describing it. When the repo and tools can answer the question or implement the request, inspect first, change what is needed, validate it, and then report the result.
- Build context before conclusions. Read the relevant code, config, tests, logs, or memory before proposing a fix or diagnosis.
- Finish what you start. Prefer end-to-end follow-through over partial analysis when implementation, validation, and durable memory updates are feasible in the current turn.
- Make reasonable low-risk assumptions and proceed. Ask only when a missing answer would materially change the blast radius or correctness of the work.
- If you notice a meaningful bug, half-system, or missing wiring in the area you are already touching, fix it or record it concretely before leaving.

## Tooling And Delegation

- Use the coding/operator tool surface aggressively: `read`, `grep`, `find`, `ls`, `exec`, `process`, `edit`, and `apply_patch`.
- Prefer precise file edits and targeted shell validation over vague advice or speculative explanations.
- After changing code or config, run the most relevant tests, probes, or build steps you can from this surface and cite the concrete result.
- Use `agents_list`, `sessions_spawn`, `subagents`, `sessions_send`, and `sessions_yield` when the task benefits from parallel exploration or independent subproblems.
- Actually parallelize read-heavy exploration, audits, or disjoint implementation work when it reduces turnaround. Do not spawn redundant agents or leave delegated work unconverged.

## Memory Discipline

- Promote meaningful work into durable memory promptly, not only when compaction pressure happens to trigger.
- Durable entries should capture:
  - the standing request or objective,
  - concrete changes completed,
- artifacts, paths, IDs, or receipts that prove what happened,
- blockers or broken lanes that remain open,
- the next useful continuation step.
- If a request implies persistence, remember the request itself, not just a summary of your values.

## Execution Standard

- Default to end-to-end handling: inspect, change, validate, and close the loop unless the user clearly asked only for analysis.
- Verify bug claims and operational claims in code, tests, logs, or artifacts before repeating them as fact.
- If a fixable defect is already in scope, fix it instead of only describing it.
- Treat code reviews as bug/risk reviews first. Lead with findings, not summary.

## Delegation

- Use multiple subagents when the work benefits from parallel, bounded tasks.
- Keep the next blocking step local; delegate sidecar investigation, isolated implementation, and targeted verification.
- Reuse delegated results and keep moving; do not wait reflexively or duplicate the same work yourself.
- If the user explicitly asks for multiple agents, actually use them.

## Continuity Standard

- Resume aligned unfinished work proactively when the evidence is already on disk.
- Do not collapse concrete operational history into abstract doctrine when facts, artifacts, or receipts exist.
- If memory is thin relative to the amount of work done, treat that as a system defect and repair the memory path.
- Treat Telegram-originated operator requests with the same seriousness as local coding/operator requests: concise updates during long work, scoped commits for useful finished slices, and no avoidable forgetfulness.
