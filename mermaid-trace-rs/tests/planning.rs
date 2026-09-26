mod support;
use serde_json::Value;

const GANTT: &str = "---\r\nconfig:\r\n  theme: default\r\n---\r\ngantt\r\n  title Plan 😀\r\n  dateFormat YYYY-MM-DD\r\n  todayMarker off\r\n  section Build\r\n  Same 😀 :done, a, 2026-01-01, 2d\r\n  Same 😀 :crit, b, after a, 1d\r\n  Ship :milestone, c, after b, 0d\r\n";

#[test]
fn gantt_plan_ac1_2_native_tasks_labels_sections_and_title() {
    let result = mermaid_trace_rs::render("planning-gantt", GANTT).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let utf16: Vec<_> = GANTT.encode_utf16().collect();
    let slice = |span: &Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let nodes: Vec<_> = pieces.iter().filter(|p| p["kind"] == "node").collect();
    assert_eq!(
        nodes.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
        [
            "Same 😀 :done, a, 2026-01-01, 2d",
            "Same 😀 :crit, b, after a, 1d",
            "Ship :milestone, c, after b, 0d"
        ]
    );
    assert_eq!(
        nodes
            .iter()
            .map(|p| slice(&p["labelSpan"]))
            .collect::<Vec<_>>(),
        ["Same 😀", "Same 😀", "Ship"]
    );
    assert_ne!(nodes[0]["domId"], nodes[1]["domId"]);
    assert!(pieces.iter().any(|p| slice(&p["span"]) == "section Build"));
    assert!(pieces.iter().any(|p| slice(&p["labelSpan"]) == "Plan 😀"));
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    assert!(
        svg.descendants()
            .any(|n| n.has_tag_name("rect") && n.attribute("data-mt-role") == Some("node"))
    );
    assert!(
        svg.descendants()
            .any(|n| n.has_tag_name("text") && n.attribute("data-mt-role") == Some("node-label"))
    );
    assert_eq!(
        result,
        mermaid_trace_rs::render("planning-gantt", GANTT).unwrap()
    );
}

#[test]
fn gantt_plan_ac2_provenance_keeps_plain_native_svg_unchanged() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let mapped = mermaid_trace_rs::render("planning-plain", GANTT).unwrap();
    let baseline = mermaid_trace_rs::render_with(&plain, "planning-plain", GANTT).unwrap();
    assert_eq!(
        support::strip_trace(mapped["svg"].as_str().unwrap()),
        support::strip_trace(baseline["svg"].as_str().unwrap())
    );
}

const JOURNEY: &str = "journey\r\n%% 😀\r\n  title Trip 😀\r\n  section Morning\r\n  Same 😀 : 5 : Alice, Bob\r\n  Same 😀 : 2 : Alice\r\n  section Evening\r\n  Rest : 3 : Bob\r\n";

#[test]
fn journey_plan_ac1_2_tasks_scores_people_and_sections_keep_original_spans() {
    let result = mermaid_trace_rs::render("planning-journey", JOURNEY).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let utf16: Vec<_> = JOURNEY.encode_utf16().collect();
    let slice = |span: &Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let tasks: Vec<_> = pieces.iter().filter(|p| p["kind"] == "node").collect();
    assert_eq!(
        tasks.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
        [
            "Same 😀 : 5 : Alice, Bob",
            "Same 😀 : 2 : Alice",
            "Rest : 3 : Bob"
        ]
    );
    assert_eq!(
        tasks
            .iter()
            .map(|p| slice(&p["labelSpan"]))
            .collect::<Vec<_>>(),
        ["Same 😀", "Same 😀", "Rest"]
    );
    assert_ne!(tasks[0]["domId"], tasks[1]["domId"]);
    assert!(
        pieces
            .iter()
            .any(|p| p["domId"] == "journey:score:0" && slice(&p["span"]) == "5")
    );
    assert!(
        pieces
            .iter()
            .any(|p| p["domId"] == "journey:actor:1:Alice" && slice(&p["span"]) == "Alice")
    );
    assert_eq!(
        pieces
            .iter()
            .filter(|p| p["domId"] == "journey:actor:Alice")
            .count(),
        2
    );
    assert!(
        pieces
            .iter()
            .any(|p| slice(&p["span"]) == "section Evening")
    );
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let baseline = mermaid_trace_rs::render_with(&plain, "planning-journey", JOURNEY).unwrap();
    assert_eq!(
        support::strip_trace(result["svg"].as_str().unwrap()),
        support::strip_trace(baseline["svg"].as_str().unwrap())
    );
}

const KANBAN: &str = "---\r\nconfig:\r\n  theme: default\r\n---\r\nkanban\r\n%% 😀\r\n  todo[Todo]\r\n    a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }\r\n    b[Same 😀]\r\n  done[Done]\r\n    c[Ship]\r\n";

#[test]
fn kanban_plan_ac1_2_columns_cards_metadata_and_relations_have_exact_spans() {
    let result = mermaid_trace_rs::render("planning-kanban", KANBAN).unwrap();
    let document = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    assert!(
        document
            .descendants()
            .any(|n| n.attribute("data-mt-key") == Some("kanban:card:a")
                && n.attribute("data-mt-role") == Some("node-label")
                && n.descendants().any(|child| child.text() == Some("Same 😀"))),
        "Kanban labels must survive the production SVG pipeline"
    );
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let utf16: Vec<_> = KANBAN.encode_utf16().collect();
    let slice = |span: &Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let cards: Vec<_> = pieces.iter().filter(|p| p["kind"] == "node").collect();
    assert_eq!(
        cards
            .iter()
            .map(|p| slice(&p["labelSpan"]))
            .collect::<Vec<_>>(),
        ["Same 😀", "Same 😀", "Ship"]
    );
    assert_eq!(
        slice(&cards[0]["span"]),
        "a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }"
    );
    assert_eq!(cards[0]["parentId"], "todo");
    assert_ne!(cards[0]["domId"], cards[1]["domId"]);
    for (field, value) in [
        ("ticket", "T-1"),
        ("assigned", "Alice"),
        ("priority", "High"),
    ] {
        assert!(
            pieces
                .iter()
                .any(|p| p["domId"] == format!("kanban:field:a:{field}")
                    && slice(&p["span"]) == value)
        );
    }
    assert!(pieces.iter().any(|p| slice(&p["span"]) == "todo[Todo]"));
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let baseline = mermaid_trace_rs::render_with(&plain, "planning-kanban", KANBAN).unwrap();
    assert_eq!(
        support::strip_trace(result["svg"].as_str().unwrap()),
        support::strip_trace(baseline["svg"].as_str().unwrap())
    );
}
