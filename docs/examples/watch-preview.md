# Publishing workflow

Select a heading or paragraph, drag **a piece of text**, or click a diagram element.

```mermaid
flowchart LR
  A[Draft] -->|review| B[Review]
  B --> C[Publish]
  A --> C
```

## Sequence diagram

This diagram renders normally. Selection currently identifies its whole fenced block; participant and message locations need source-map support in the Mermaid fork.

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
