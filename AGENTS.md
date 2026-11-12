<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Comments

1. Guarantees go in tests, not comments. If a comment claims an invariant ("항상", "반드시", "never", "must") that no test covers, write a test and drop or shorten the comment.
2. Comments say WHY only: a non-obvious constraint, a workaround's reason, or a gotcha. Don't restate what the code does. If a comment contradicts the code, fix the comment. Never trust it over the code.
3. No issue, ticket, commit, plan, or migration IDs in comments (`#123`, `Q1-06`, `D16`, `§9`, hashes, `(0054)`). History lives in git and `docs/`. If an ID carries a rule the reader needs, write the rule out in a few words.
4. Bugs: reproduce with a failing test first, fix, then show it passing.

## UI consistency

1. Copies: if the element you change is a copy of a shared class constant or component (a separate constant or inline string whose classes mostly match it), replace it with the shared one and delete the copy. Editing the copy's value is not reuse.
2. All states: when you move or restyle a button or toggle, grep every branch that renders it (on/off, empty state, list/detail) and keep it in the same place and shape across them, including right after it is pressed. For a branch you leave as is, say why in your report.
