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
