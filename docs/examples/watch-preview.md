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
