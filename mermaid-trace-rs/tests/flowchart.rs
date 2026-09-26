mod support;
use serde_json::Value;
use support::strip_trace;

#[test]
fn map_native_ac1_retains_flowchart_occurrences_and_original_ranges() {
    let source =
        "flowchart LR\r\n%% 😀 comment\r\nA[\"same\"] -->|same| B[\"same\"]\r\nA -->|same| B";
    let result = mermaid_trace_rs::render("flow-ranges", source).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let utf16: Vec<_> = source.encode_utf16().collect();
    let slice = |span: &Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let nodes: Vec<_> = pieces.iter().filter(|p| p["kind"] == "node").collect();
    let edges: Vec<_> = pieces.iter().filter(|p| p["kind"] == "edge").collect();
    assert_eq!(
        nodes.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
        ["A[\"same\"]", "B[\"same\"]", "A", "B"]
    );
    assert_eq!(
        nodes[0]["labelSpan"],
        serde_json::json!({"start":32,"end":36})
    );
    assert_eq!(
        nodes[1]["labelSpan"],
        serde_json::json!({"start":52,"end":56})
    );
    assert_eq!(
        edges.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
        ["-->|same|", "-->|same|"]
    );
    assert_eq!(
        edges[0]["labelSpan"],
        serde_json::json!({"start":43,"end":47})
    );
    assert_eq!(
        edges[1]["labelSpan"],
        serde_json::json!({"start":66,"end":70})
    );
    assert_ne!(edges[0]["domId"], edges[1]["domId"]);
    for edge in edges {
        assert_eq!(edge["from"], "A");
        assert_eq!(edge["to"], "B");
    }
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    let node = svg
        .descendants()
        .find(|n| {
            n.attribute("data-mt-role") == Some("node")
                && n.attribute("data-mt-key") == Some("node:A")
        })
        .unwrap();
    assert_eq!(
        node.attribute("data-mt-refs")
            .unwrap()
            .split_whitespace()
            .count(),
        2
    );
    assert_eq!(node.attribute("data-mt-start"), Some("29"));
}

#[test]
fn map_native_ac1_2_existing_fixtures_keep_native_mappings_and_static_output() {
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for name in ["repeated-labels", "decisions", "keywords", "whitespace"] {
        let source = std::fs::read_to_string(format!(
            "../mermaid-trace-ts/test/fixtures/flowchart/{name}.mmd"
        ))
        .unwrap();
        let result = mermaid_trace_rs::render_with(&renderer, name, &source).unwrap();
        assert!(
            result["mapping"]["pieces"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["kind"] == "edge"),
            "{name}"
        );
        assert!(
            result["svg"]
                .as_str()
                .unwrap()
                .contains("data-mt-role=\"node\""),
            "{name}"
        );
        assert!(!result["svg"].as_str().unwrap().contains("<script"));
        assert_eq!(
            mermaid_trace_rs::render_with(&renderer, name, &source).unwrap(),
            result
        );
        let baseline = mermaid_trace_rs::render_with(&plain, name, &source).unwrap();
        assert_eq!(
            strip_trace(result["svg"].as_str().unwrap()),
            strip_trace(baseline["svg"].as_str().unwrap()),
            "annotation changed {name} rendering"
        );
    }
}

#[test]
fn map_native_ac1_preprocessing_chains_and_declarations_preserve_parity() {
    let source = "---\r\nconfig:\r\n  theme: default\r\n---\r\ngraph LR\r\n%% 😀\r\nA --> B\r\nsubgraph G\r\nA[\"Café 😀\"] -->|go| C(Round) --> D{Done}\r\nend\r\n";
    let result = mermaid_trace_rs::render("flow-preprocess", source).unwrap();
    let utf16: Vec<_> = source.encode_utf16().collect();
    let slice = |span: &Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let nodes: Vec<_> = pieces.iter().filter(|p| p["kind"] == "node").collect();
    assert_eq!(
        nodes.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
        ["A", "B", "A[\"Café 😀\"]", "C(Round)", "D{Done}"]
    );
    assert_eq!(
        nodes
            .iter()
            .filter_map(|p| p.get("labelSpan"))
            .map(slice)
            .collect::<Vec<_>>(),
        ["Café 😀", "Round", "Done"]
    );
    let edges: Vec<_> = pieces.iter().filter(|p| p["kind"] == "edge").collect();
    assert_eq!(
        edges.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
        ["-->", "-->|go|", "-->"]
    );
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    let primary = svg
        .descendants()
        .find(|n| n.attribute("data-mt-key") == Some("node:A"))
        .unwrap();
    assert_eq!(
        slice(
            &serde_json::json!({"start":primary.attribute("data-mt-start").unwrap().parse::<u32>().unwrap(), "end":primary.attribute("data-mt-end").unwrap().parse::<u32>().unwrap()})
        ),
        "A[\"Café 😀\"]"
    );
    assert!(
        mermaid_trace_rs::render("flow-repeat", "flowchart LR\nA[x]\nA[y] --> B")
            .unwrap_err()
            .contains("Unsupported source map")
    );
}
