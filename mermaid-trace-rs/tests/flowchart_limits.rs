mod support;

use serde_json::json;

#[test]
fn flow_ac5_host_edge_limits_apply_before_both_layouts_and_keep_boundary_mapping() {
    for layout in ["dagre", "elk"] {
        let renderer = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
            merman::MermaidConfig::from_value(json!({
                "maxEdges": 4, "traceSource": true, "htmlLabels": false, "layout": layout,
            })),
        ));
        let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
            merman::MermaidConfig::from_value(json!({
                "maxEdges": 4, "traceSource": false, "htmlLabels": false, "layout": layout,
            })),
        ));
        for prefix in [
            "",
            "---\nconfig: {maxEdges: 100}\n---\n",
            "%%{init: {maxEdges: 100}}%%\n",
        ] {
            let source = format!("{prefix}flowchart LR\nsubgraph G\nA & B --> C & D\nend");
            let result = mermaid_trace_rs::render_with(&renderer, "edge-limit", &source).unwrap();
            let svg = result["svg"].as_str().unwrap();
            let document = roxmltree::Document::parse(svg).unwrap();
            let edges: Vec<_> = document
                .descendants()
                .filter(|n| n.attribute("data-mt-role") == Some("edge"))
                .collect();
            assert_eq!(edges.len(), 4, "{layout}");
            for edge in edges {
                let start: usize = edge.attribute("data-mt-start").unwrap().parse().unwrap();
                let end: usize = edge.attribute("data-mt-end").unwrap().parse().unwrap();
                assert_eq!(&source[start..end], "-->");
            }
            let reference = mermaid_trace_rs::render_with(&plain, "edge-limit", &source).unwrap();
            assert_eq!(
                support::strip_trace(svg),
                support::strip_trace(reference["svg"].as_str().unwrap())
            );
            let invalid = format!("{source}\nD --> A");
            let error = mermaid_trace_rs::render_with(&renderer, "edge-limit", &invalid)
                .err()
                .expect("over-limit input must fail");
            assert!(error.contains("maxEdges") && error.contains('4'), "{error}");
            assert_eq!(
                mermaid_trace_rs::render_with(&renderer, "edge-limit", &source).unwrap()["svg"],
                result["svg"],
                "failed render must not change subsequent output"
            );
        }
    }
}

#[test]
fn flow_ac5_default_edge_limit_cannot_be_raised_by_diagram_source() {
    let source = format!(
        "---\nconfig: {{maxEdges: 1000}}\n---\nflowchart LR\n{}",
        "A --> B\n".repeat(501)
    );
    let error = mermaid_trace_rs::render("edge-limit", &source)
        .err()
        .expect("over-limit input must fail");
    assert!(
        error.contains("maxEdges") && error.contains("500"),
        "{error}"
    );
}
