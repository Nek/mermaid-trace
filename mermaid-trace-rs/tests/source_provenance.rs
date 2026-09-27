mod support;
use serde_json::{Value, json};

#[test]
fn own_config_all_mapped_families_retain_original_nonvisual_evidence() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for body in [
        "flowchart LR\r\nA[Actor] --> B\r\n",
        "stateDiagram-v2\r\nA --> B\r\n",
        "sequenceDiagram\r\nparticipant A\r\nparticipant B\r\nA->>B: Message\r\n",
        "gantt\r\ndateFormat YYYY-MM-DD\r\ntodayMarker off\r\nTask :a, 2026-01-01, 2d\r\n",
        "journey\r\nTask : 5 : Alice\r\n",
        "kanban\r\na[Column]\r\n  b[Task]\r\n",
    ] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                let frontmatter = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  unknown:\r\n    nested: 'Value 😀'\r\n---\r\n"
                );
                let first = "%%{init: { values: [{ nested: 'First 😀' }], theme: 'default' }}%%";
                let second = format!(
                    "%%{{initialize: {{ \"html\\u004cabels\": {html}, values: [{{ nested: 'Last 😀' }}] }}}}%%"
                );
                let source = format!("\u{feff}{frontmatter}{first}\r\n{second}\r\n{body}");
                let result = mermaid_trace_rs::render("config-owner", &source).unwrap();
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let native: Vec<Value> = serde_json::from_str(
                    svg.descendants()
                        .find_map(|node| node.attribute("data-mt-native"))
                        .unwrap(),
                )
                .unwrap();
                let slice = |span: &Value| {
                    &source[span["start"].as_u64().unwrap() as usize
                        ..span["end"].as_u64().unwrap() as usize]
                };
                let fronts: Vec<_> = native
                    .iter()
                    .filter(|piece| piece["classification"] == "frontmatter")
                    .collect();
                assert_eq!(fronts.len(), 1, "{body}");
                assert_eq!(slice(&fronts[0]["span"]), frontmatter);
                for (order, statement, keyword) in
                    [(0, first, "init"), (1, second.as_str(), "initialize")]
                {
                    let piece = native
                        .iter()
                        .find(|piece| {
                            piece["classification"] == "source-directive" && piece["order"] == order
                        })
                        .unwrap();
                    assert_eq!(piece["keyword"], keyword);
                    assert_eq!(piece["complete"], true);
                    assert_eq!(slice(&piece["span"]), statement);
                }
                let yaml = native
                    .iter()
                    .find(|piece| piece["path"] == json!(["config", "unknown", "nested"]))
                    .unwrap();
                assert_eq!(slice(&yaml["span"]), "nested: 'Value 😀'");
                assert_eq!(slice(&yaml["labelSpan"]), "Value 😀");
                assert_eq!(yaml["origin"], json!({"kind":"frontmatter"}));
                let values: Vec<_> = native
                    .iter()
                    .filter(|piece| piece["path"] == json!(["values", 0, "nested"]))
                    .collect();
                assert_eq!(values.len(), 2);
                for (index, value) in values.iter().enumerate() {
                    assert_eq!(value["origin"], json!({"kind":"directive","index":index}));
                    assert_eq!(
                        slice(&value["labelSpan"]),
                        if index == 0 {
                            "First 😀"
                        } else {
                            "Last 😀"
                        }
                    );
                }
                let escaped = native
                    .iter()
                    .find(|piece| piece["path"] == json!(["htmlLabels"]))
                    .unwrap();
                assert_eq!(
                    slice(&escaped["span"]),
                    format!("html\\u004cabels\": {html}")
                );
                assert_eq!(slice(&escaped["labelSpan"]), html.to_string());
                assert!(
                    native
                        .iter()
                        .filter(|piece| matches!(
                            piece["classification"].as_str(),
                            Some("frontmatter" | "source-directive" | "configuration-key")
                        ))
                        .all(|piece| piece["kind"] == "nonvisual" && piece.get("domId").is_none())
                );
                assert!(
                    result["mapping"]["pieces"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .all(|piece| piece["kind"] != "nonvisual")
                );
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "config-owner", &source).unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(baseline["svg"].as_str().unwrap()),
                    "{body}/{look}/{html}"
                );
            }
        }
    }
}
