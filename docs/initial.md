# Project explanation

Build a self-hosted task-management system designed specifically for AI-assisted software development.

The long-term product will coordinate work performed through Codex, Claude Code, ChatGPT, and other agents. It will eventually manage session history, vector search and RAG, repository branches, commits, pull requests, artifacts, decisions, evaluations, handoffs, agent permissions, MCP tools, and automated workflows.

The first version must deliberately exclude those advanced capabilities. It should implement only a small, reliable task-management core inspired by Linear, but built around a project-agnostic flow model.

The purpose of this first version is to establish the correct domain model, interaction model, and source of truth before adding AI orchestration.

This is not intended to be a general-purpose clone of Linear, Jira, or Plane. It is the foundation of a future AI-assisted-development operating system.

## Core domain model

The primary structure is:

```text
Workspace
├── Projects
├── Flows
└── Tasks
```

These are three separate first-class entities.

They are connected through relationships rather than a rigid hierarchy.

### Projects

A project represents the technical ownership boundary of work.

A project will usually correspond to:

- A software product
- A Git repository
- A service
- A library
- A major independent technical initiative

Examples:

- Fiction Compiler
- Architecture Lens
- Psyght Transcript
- LangReader
- Meeting Recording Extension

Projects answer:

> Where does this work belong technically?

Projects should remain relatively stable even when development priorities change.

### Flows

A flow represents continuity of purpose.

It is a persistent direction of execution, investigation, coordination, uncertainty reduction, or product evolution.

Flows are project-agnostic. They exist at workspace level and may contain tasks from any number of projects.

Examples:

- AI evaluation infrastructure
- Transcription pipeline selection
- Architecture migration
- Recording reliability
- Context and knowledge management
- Human-review quality gates
- Performance benchmarking
- Release readiness
- Privacy-preserving local inference
- Product redesign

Flows answer:

> Why are these tasks related, and toward what outcome or convergence are they moving?

A flow may:

- Contain tasks from one project
- Span several projects
- Represent shared infrastructure work
- Exist before implementation tasks are known
- Continue across multiple agents and development sessions
- Survive the completion of individual tasks

Tasks complete. Flows evolve or converge.

### Tasks

A task is a bounded, actionable unit of work.

Every task should belong to exactly one project, because implementation work needs a clear technical ownership boundary.

A task may belong to:

- Zero or one primary flow
- Zero or more related flows

Recommended relationship model:

```text
Task → exactly one Project
Task → zero or one Primary Flow
Task → zero or more Related Flows
Flow → tasks from any number of Projects
```

A task should have only one primary flow.

The primary flow owns the task’s purpose, sequencing, and contribution to progress.

Related flows provide additional context and discoverability but do not own the task.

Example:

```text
Task:
Benchmark local transcription latency

Project:
Psyght Transcript

Primary flow:
Transcription pipeline selection

Related flows:
AI evaluation infrastructure
Privacy-preserving local inference
```

The central architectural principle is:

> Projects define technical ownership. Flows define continuity of purpose. Tasks connect the two.

## Workspace

A workspace contains the complete development portfolio.

It should provide:

- Projects
- Flows
- Tasks
- Milestones
- Labels
- Configurable workflows
- Portfolio-level activity
- Cross-project and cross-flow dependencies

The workspace view should help the user decide what deserves attention now.

It should not present every captured task, project, or flow as equally important.

## Project model

A project should contain:

- Name
- Description
- Status
- Priority
- Health
- Current focus
- Repository placeholder for future integration
- Project-specific milestones
- Tasks
- Active flows derived from its tasks
- Short current-state summary
- Created and updated timestamps

Suggested project statuses:

```text
Proposed
Planned
Active
Paused
Completed
Archived
```

Project status describes whether the product or technical initiative is currently being pursued.

Project health may use:

```text
On Track
At Risk
Off Track
Unknown
```

Do not calculate project health from task counts alone. It should reflect blockers, unresolved decisions, dependency risk, and current evidence.

## Flow model

A flow should contain:

- Name
- Purpose or objective
- Status
- Priority
- Health
- Current focus
- Convergence criteria
- Primary current task
- Related tasks from one or more projects
- Participating projects, derived from tasks
- Optional allowed-project scope
- Dependencies on other flows
- Responsible person or future agent
- Current-state summary
- Important findings
- Next recommended action
- Created and updated timestamps

Suggested flow statuses:

```text
Proposed
Active
Paused
Converged
Closed
```

Meanings:

- **Proposed:** a possible direction that has not yet been accepted.
- **Active:** currently receiving investigation or execution.
- **Paused:** valid but intentionally not receiving attention.
- **Converged:** the principal uncertainty or objective has been resolved.
- **Closed:** abandoned, obsolete, merged into another flow, or no longer relevant.

A converged flow is not the same as a completed task.

For example, a `Transcription pipeline selection` flow converges when a supported backend decision is made. Implementation, integration, and hardening tasks may continue in another flow.

### Flow convergence

Each flow should have explicit convergence criteria.

Examples:

- A backend is selected using reproducible benchmark evidence.
- An architecture migration has stable boundaries and dependent work may proceed.
- A release gate is satisfied with no unresolved critical defects.
- An evaluation methodology produces stable, repeatable results.
- A redesign direction has been approved and documented.

Flow progress must not be a manually entered percentage.

It should be derived from signals such as:

- Task states
- Blocking relationships
- Completion of convergence criteria
- Unresolved decisions
- Human-review gates
- Dependency state
- Evidence produced

Derived progress must remain explainable. The interface should show why a flow appears healthy, blocked, or close to convergence.

### Flow dependencies

Flows may block or depend on other flows.

Examples:

```text
Evaluation corpus
    blocks
Pipeline benchmarking

Pipeline benchmarking
    blocks
Backend selection

Architecture migration
    blocks
Product redesign
```

Dependencies should be explicit and visible.

A flow should not be marked converged while required blocking flows remain unresolved unless the user explicitly overrides the rule.

### Flow project scope

A flow should not require a project owner.

Its participating projects should normally be derived from linked tasks.

Optionally, a flow may define an allowed scope:

```text
All projects
Selected projects
```

This is a constraint on task participation, not project ownership.

## Task model

A task is a finite unit of execution that should eventually reach a terminal state.

Suggested task lifecycle:

```text
Inbox
Planned
Ready
In Progress
Human Review
Blocked
Done
Cancelled
```

Meanings:

- **Inbox:** captured but not yet accepted or sufficiently understood.
- **Planned:** accepted as useful work but not ready to execute.
- **Ready:** sufficiently scoped for a person or agent to begin.
- **In Progress:** currently being executed.
- **Human Review:** implementation or evidence exists, but human judgment is required.
- **Blocked:** cannot proceed because of an explicitly recorded dependency or condition.
- **Done:** acceptance criteria have been satisfied and evidence has been recorded.
- **Cancelled:** intentionally abandoned, duplicated, or made obsolete.

Every task should support:

- Title
- Description
- Project
- Optional primary flow
- Related flows
- Status
- Priority
- Assignee
- Optional milestone
- Labels
- Parent task
- Subtasks
- Blocking relations
- Blocked-by relations
- Related-task relations
- Duplicate relation
- Acceptance checklist
- Readiness criteria
- Completion evidence
- Human-review requirements
- Optional due date
- Comments
- Immutable activity history
- Created timestamp
- Updated timestamp
- Started timestamp
- Completed timestamp

### Readiness

Moving a task to `Ready` should mean that:

- The goal is clear.
- The project is known.
- The scope is bounded.
- Acceptance criteria are present.
- Important dependencies are known.
- Required human decisions have either been resolved or made explicit.
- An agent or person could begin without rediscovering the task’s purpose.

The initial version may warn rather than strictly block invalid transitions, but the model should support future enforcement.

### Completion

Moving a task to `Done` should require more than changing a status.

The system should make these visible:

- Acceptance criteria
- Verification performed
- Completion evidence
- Remaining limitations
- Follow-up work
- Human approval where required

Strict completion enforcement may be configurable, but the domain model should support it from the beginning.

## Milestones

Milestones represent concrete delivery checkpoints.

Examples:

- Evaluation baseline complete
- Architecture migration complete
- Beta release
- Release candidate
- Public launch

Milestones should not be used as permanent categories.

A milestone may belong to:

- One project
- Optionally one flow
- A set of tasks

The first version should keep milestones simple.

## Labels

Labels provide cross-cutting classification.

Examples:

```text
bug
feature
research
evaluation
decision
architecture
design
performance
security
privacy
documentation
release
technical-debt
agent-found
human-gate
optional
```

Labels should supplement the domain model, not replace projects, flows, statuses, or milestones.

## Task and flow relations

The system should support:

### Task relations

- Parent and subtask
- Blocks
- Blocked by
- Related
- Duplicate of

### Flow relations

- Blocks
- Blocked by
- Related
- Replaces
- Merged into

Relations should have:

- Relation type
- Source entity
- Target entity
- Optional explanation
- Creation timestamp
- Creator

The system should prevent invalid or circular blocking relations where practical.

## Comments and activity history

Tasks and flows should support comments.

Comments are for:

- Progress
- Questions
- Review feedback
- New evidence
- Clarifications
- Decisions that have not yet become formal artifacts

The system must also keep an immutable activity history for meaningful changes:

- Status changes
- Priority changes
- Assignment changes
- Project changes
- Flow relationships
- Task relations
- Acceptance-criteria edits
- Completion evidence
- Comments
- Milestone changes

The user should be able to understand how an item reached its current state.

## Interaction model

The first version should provide a compact control-room interface rather than a corporate project-management dashboard.

Essential views:

- Workspace portfolio
- Project overview
- Flow overview
- Task list
- Kanban board
- Task details
- Flow details
- Search
- Filtering
- Activity history

## Portfolio view

The portfolio should emphasize:

- Active projects
- Active flows
- Current focus flows
- High-priority Ready tasks
- Tasks in progress
- Work awaiting human review
- Blocked flows and tasks
- Cross-project flows
- Cross-flow dependencies
- Paused or dormant work
- Recently converged flows

The portfolio should help answer:

- What should I work on now?
- Which flow is currently most important?
- Which project is receiving too much or too little attention?
- Which work is blocked?
- Which tasks require human judgment?
- Which flow is close to convergence?
- Which projects contribute to the same strategic objective?

## Project page

The project page should show:

- Project purpose
- Status, priority, and health
- Current focus
- Active tasks
- Active flows involving the project
- Milestones
- Blocked work
- Human-review work
- Recent activity
- Next recommended action

Because flows are project-agnostic, the project page should show flows derived from tasks in that project rather than treating flows as children owned by the project.

## Flow page

The flow page should be the main strategic working surface.

It should show:

- Why the flow exists
- Purpose
- Status
- Priority
- Health
- Current focus
- Convergence criteria
- Primary current task
- Tasks grouped by project
- Participating projects
- Active, Ready, blocked, and Human Review tasks
- Dependencies on other flows
- Important findings
- Recent activity
- What should happen next

A cross-project flow should make the project boundaries visible without fragmenting the flow.

## Task page

The task page should be optimized for future use by AI agents, even though direct agent integration is excluded from the first version.

It should clearly expose:

- Goal
- Project
- Primary flow
- Related flows
- Scope
- Acceptance criteria
- Readiness criteria
- Dependencies
- Status
- Completion evidence
- Human-review requirements
- Comments
- Activity history
- Follow-up work

## Search and filtering

The first version should support structured search and filtering across:

- Projects
- Flows
- Tasks
- Statuses
- Priorities
- Labels
- Milestones
- Assignees
- Relations
- Dates

Useful filters include:

- Tasks without a flow
- Cross-project flows
- Blocked flows
- Tasks awaiting human review
- Ready tasks by project
- Tasks related to several flows
- Flows without current focus
- Flows with unsatisfied convergence criteria
- Stale active flows

Full-text search may initially remain simple.

Do not add vector search or embeddings in the first version.

## Minimal first-version boundaries

The first version should include:

- Workspace
- Projects
- Project-agnostic flows
- Tasks
- Milestones
- Configurable task and flow states
- Priorities
- Labels
- Parent and subtask hierarchy
- Task relations
- Flow relations and dependencies
- Primary and related flow associations
- Comments
- Immutable activity history
- List view
- Board view
- Portfolio dashboard
- Project page
- Flow page
- Task page
- Search and filtering
- Data export and backup
- Local or self-hosted operation
- Stable API-oriented internal architecture

## Explicitly excluded from the first version

The first version should not include:

- Vector databases
- Embeddings
- RAG
- Importing Codex sessions
- Importing Claude Code sessions
- Importing ChatGPT conversations
- Session parsing
- GitHub integration
- Repository synchronization
- Branch management
- Commit or pull-request tracking
- MCP servers
- Agent execution
- Agent permissions
- Automatic task generation
- Artifact extraction
- Workflow automation
- Evaluation pipelines
- External notifications
- External integrations
- Advanced analytics
- Enterprise access control
- Distributed services
- Microservice architecture

Do not create placeholder implementations of these advanced features merely to make the product appear comprehensive.

The first version should remain small enough to understand, test, and change safely.

## Future direction

The architecture must leave a clean path for later entities such as:

- AI development sessions
- Session messages
- Agents
- Agent runs
- Repositories
- Branches
- Commits
- Pull requests
- Research notes
- Specifications
- Decisions
- Claims
- Evidence
- Evaluations
- Generated artifacts
- Handoffs
- Context chunks
- Embeddings
- Retrieval collections
- Workflow definitions
- Workflow runs
- Human approval gates

Eventually, sessions from Codex, Claude Code, ChatGPT, and other systems will be ingested into a controlled knowledge layer.

Their contents will be:

- Parsed
- Segmented
- Classified
- Linked to projects
- Linked to flows
- Linked to tasks
- Linked to branches and artifacts
- Embedded
- Retrieved through RAG
- Evaluated for reliability and temporal relevance

The future system must distinguish:

- Raw session history
- Agent-generated claims
- Verified facts
- Accepted decisions
- Superseded information
- Speculative ideas
- Canonical project knowledge

RAG must not treat every agent statement as truth.

Claims should eventually support:

- Provenance
- Source session
- Source message
- Author or agent
- Timestamp
- Confidence
- Verification state
- Temporal validity
- Supporting evidence
- Contradicting evidence
- Superseding claims
- Related project, flow, task, branch, and artifact

This future architecture should influence identifiers, event history, and extension boundaries, but must not expand the first implementation.

## Product principles

1. **Projects define technical ownership.**
2. **Flows define continuity of purpose.**
3. **Tasks connect projects and flows.**
4. **Tasks are finite; flows are persistent.**
5. **A flow may span any number of projects.**
6. **A task has one project and at most one primary flow.**
7. **Related flows provide context but do not own the task.**
8. **The interface should help choose the next meaningful action, not merely store tickets.**
9. **Readiness and completion require explicit criteria and evidence.**
10. **Human-review boundaries must remain visible.**
11. **History should be preserved rather than silently rewritten.**
12. **Derived progress must remain explainable.**
13. **Automation added later must be inspectable and reversible.**
14. **Raw AI output must never automatically become canonical project knowledge.**
15. **The system should be API-oriented but not prematurely distributed.**
16. **Simple, reliable behavior is more valuable than feature count.**
17. **The first version must be useful as a manual task manager before AI integration exists.**

The immediate product is therefore a focused, flow-based task manager with project-agnostic flows.

Its deeper purpose is to become the trustworthy control, workflow, and memory layer for a fully AI-assisted software-development process.
