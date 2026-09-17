# Architecture decision records

Short records of decisions that are expensive to reverse. Each record states the context, the
decision, and its consequences. To supersede a decision, add a new record and mark the old one as
superseded; do not rewrite history.

| ADR                                            | Title                                             | Status   |
| ---------------------------------------------- | ------------------------------------------------- | -------- |
| [0001](0001-markdown-not-mdx.md)               | Article bodies are Markdown, not MDX              | Accepted |
| [0002](0002-queue-leases.md)                   | Supabase queue with leases and optimistic locking | Accepted |
| [0003](0003-provider-isolation.md)             | Provider adapters are isolated from publishing    | Accepted |
| [0004](0004-public-admin-layout-separation.md) | Separate root layouts for public and admin        | Accepted |
| [0005](0005-project-local-node-runtime.md)     | Project-local Node 24 runtime via pnpm            | Accepted |
| [0006](0006-admin-authentication-boundary.md)  | Where the admin authentication boundary lives     | Accepted |
