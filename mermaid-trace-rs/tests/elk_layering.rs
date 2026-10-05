mod support;
use serde_json::json;
use std::collections::BTreeMap;

fn positions(source: &str) -> BTreeMap<String, f64> {
    let result = mermaid_trace_rs::render("layers", source).unwrap();
    let xml = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    xml.descendants()
        .filter(|node| node.attribute("data-mt-role") == Some("node"))
        .map(|node| {
            let key = node.attribute("data-mt-key").unwrap().to_owned();
            let position: Vec<f64> = node
                .attribute("transform")
                .unwrap()
                .strip_prefix("translate(")
                .unwrap()
                .trim_end_matches(')')
                .split(',')
                .map(|value| value.parse().unwrap())
                .collect();
            (key, position[1])
        })
        .collect()
}

#[test]
fn flow_ac5_coffman_graham_honors_authored_layer_bounds() {
    let body = "flowchart TB\nA[Alpha] --> B[Beta]\nA --> C[Gamma]\nA --> D[Delta]\nB --> E[End]\nC --> E\nD --> E\nA --> E\n";
    for bound in [1, 2] {
        let source = format!(
            "---\nconfig: {}\n---\n{body}",
            json!({"layout":"elk", "elk":{"layeringStrategy":"COFFMAN_GRAHAM", "layeringLayerBound":bound}})
        );
        let ys = positions(&source);
        assert_eq!(ys.len(), 5);
        let mut rows: Vec<_> = ys.values().copied().collect();
        rows.sort_by(f64::total_cmp);
        rows.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
        assert_eq!(rows.len(), if bound == 1 { 5 } else { 4 });
        for y in ys.values() {
            assert!(
                ys.values()
                    .filter(|other| (*other - y).abs() < 1e-6)
                    .count()
                    <= bound,
                "bound {bound} must constrain the actual rendered rows: {ys:?}"
            );
        }
    }
}

#[test]
fn flow_ac5_longest_path_choices_align_short_branches_at_opposite_ends() {
    let body = "flowchart TB\nA --> B --> C --> D\nA --> E --> D\nA --> F\n";
    let source = |strategy| {
        format!(
            "---\nconfig: {}\n---\n{body}",
            json!({"layout":"elk","elk":{"layeringStrategy":strategy}})
        )
    };
    let sink = positions(&source("LONGEST_PATH"));
    let start = positions(&source("LONGEST_PATH_SOURCE"));
    assert!(
        (sink["node:F"] - sink["node:D"]).abs() < 1e-6,
        "sink-aligned short branch: {sink:?}"
    );
    assert!(
        (start["node:F"] - start["node:B"]).abs() < 1e-6,
        "source-aligned short branch: {start:?}"
    );
    assert!(start["node:F"] < start["node:D"]);
}

#[test]
fn flow_ac5_layering_keeps_nested_defaults_labels_cycles_and_provenance() {
    let group =
        "subgraph G[Group]\nA[Alpha] e@-->|next| B[Beta]\nB --> C[Gamma]\nC --> A\nA s@--> A\nend";
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(json!({"traceSource":false,"htmlLabels":false})),
    ));
    let mut nested: Option<[f64; 3]> = None;
    for strategy in [
        "NETWORK_SIMPLEX",
        "LONGEST_PATH",
        "LONGEST_PATH_SOURCE",
        "COFFMAN_GRAHAM",
    ] {
        for body in [
            "flowchart TB\nA[Alpha] e@-->|next| B[Beta]\nB --> C[Gamma]\nC --> A\nA s@--> A\nD[Detached]".to_owned(),
            format!("flowchart TB\n{group}\nX --> Y\nX --> Z"),
        ] {
            let source = format!("---\nconfig: {}\n---\n{body}", json!({"layout":"elk","elk":{"layeringStrategy":strategy,"layeringLayerBound":1}}));
            let actual = mermaid_trace_rs::render_with(&renderer, "layers", &source).unwrap();
            let reference = mermaid_trace_rs::render_with(&plain, "layers", &source).unwrap();
            assert_eq!(support::strip_trace(actual["svg"].as_str().unwrap()), support::strip_trace(reference["svg"].as_str().unwrap()));
            assert_eq!(actual["source"], source);
            for (key, role, text) in [("node:A","node-label","Alpha"),("edge:e","edge-label","next"),("edge:s","edge","s@-->")] {
                let xml = roxmltree::Document::parse(actual["svg"].as_str().unwrap()).unwrap();
                let visual = xml.descendants().find(|n| n.attribute("data-mt-key") == Some(key) && n.attribute("data-mt-role") == Some(role)).unwrap();
                let start: usize = visual.attribute("data-mt-start").unwrap().parse().unwrap();
                let end: usize = visual.attribute("data-mt-end").unwrap().parse().unwrap();
                assert_eq!(&source[start..end], text);
            }
            if body.contains("subgraph") {
                let ys = positions(&source);
                let inner = [0.0, ys["node:B"] - ys["node:A"], ys["node:C"] - ys["node:A"]];
                if let Some(expected) = nested {
                    // Subtracting absolute SVG translations may differ in the final float bits.
                    for (actual, expected) in inner.into_iter().zip(expected) {
                        assert!((actual - expected).abs() < 1e-9, "root layering must not leak into nested graphs");
                    }
                } else {
                    nested = Some(inner);
                }
            }
        }
    }
}

#[test]
fn flow_ac5_layer_bound_only_affects_coffman_graham() {
    let body = "flowchart TB\nA --> B --> C --> D\nA --> E --> D\nA --> F\n";
    for strategy in ["NETWORK_SIMPLEX", "LONGEST_PATH", "LONGEST_PATH_SOURCE"] {
        let source = |bound| {
            format!(
                "---\nconfig: {}\n---\n{body}",
                json!({"layout":"elk","elk":{"layeringStrategy":strategy,"layeringLayerBound":bound}})
            )
        };
        assert_eq!(positions(&source(1)), positions(&source(20)));
    }
}

#[test]
fn flow_ac5_coffman_graham_numeric_bounds_follow_elk_threshold_semantics() {
    // Pinned elkjs 0.9.3 compares integer layer size against the authored numeric bound.
    let source = |bound| {
        format!(
            "---\nconfig: {}\n---\nflowchart TB\nA --> B\nA --> C\n",
            json!({"layout":"elk","elk":{"layeringStrategy":"COFFMAN_GRAHAM","layeringLayerBound":bound}})
        )
    };
    for (authored, effective) in [(-1.0, 1), (0.0, 1), (0.5, 1), (1.5, 2)] {
        assert_eq!(
            positions(&source(json!(authored))),
            positions(&source(json!(effective))),
            "bound {authored}"
        );
    }
}
