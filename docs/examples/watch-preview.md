# Publishing workflow

Select a heading or paragraph, drag **a piece of text**, or click a diagram element.

```mermaid
flowchart LR
  A[Draft] -->|review| B[Review]
  B --> C[Publish]
  A --> C
```

## Sequence diagram

Select participants, connectors or labels to copy their source locations. Clicking the background selects the whole diagram.

```mermaid
sequenceDiagram
  participant Author
  participant Reviewer
  participant Publisher
  Author->>Reviewer: Submit draft
  Reviewer-->>Author: Review comments
  Author->>Publisher: Approved version
  Publisher-->>Author: Published
```

## Gantt plan

Select task bars, milestones, labels, the section or title.

```mermaid
gantt
  title Release plan
  dateFormat YYYY-MM-DD
  todayMarker off
  section Development
  Implement :done, build, 2026-09-01, 4d
  Review :crit, review, after build, 2d
  Release :milestone, release, after review, 0d
```

## User journey

Select tasks, labels, scores or actor circles and legend entries.

```mermaid
journey
  title Publish a document
  section Preparation
  Draft : 5 : Author
  Review : 3 : Author, Reviewer
  section Delivery
  Publish : 4 : Publisher
  section Preparation
  Revise : 2 : Author
```

## Kanban board

Select columns, cards, labels, ticket/assignee text or the priority stripe.

```mermaid
kanban
  todo[To do]
    draft[Draft]@{ ticket: 'DOC-1', assigned: 'Author', priority: 'High' }
    review[Review]@{ assigned: 'Reviewer' }
  done[Done]
    publish[Publish]
```

## State diagram

Select states, individual description rows, concurrent regions, composite frames, transitions or attached notes.

```mermaid
stateDiagram-v2
  [*] --> Editing
  state Editing {
    state "Draft" as Draft: Editable content
    Draft : Can be revised
    Draft : Can be revised
    state "Review" as Review
    [*] --> Draft
    Draft --> Review : submit
    Review --> Draft : revise
    Review --> [*] : approve
    --
    [*] --> Indexing
    Indexing --> [*] : indexed
  }
  Editing --> Published : publish
  Published --> [*]
  note right of Published : Available to readers
```
