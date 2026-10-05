mod support;
use serde_json::json;

fn position(svg: &str, key: &str) -> [f64; 2] {
    let doc = roxmltree::Document::parse(svg).unwrap();
    let node = doc
        .descendants()
        .find(|n| {
            n.attribute("data-mt-role") == Some("node") && n.attribute("data-mt-key") == Some(key)
        })
        .unwrap();
    let transform = node.attribute("transform").unwrap();
    let values: Vec<f64> = transform
        .trim_start_matches("translate(")
        .trim_end_matches(')')
        .split(',')
        .map(|v| v.trim().parse().unwrap())
        .collect();
    [values[0], values[1]]
}

#[test]
fn flow_ac5_elk_cycle_entry_follows_forward_edges_not_node_declarations() {
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(json!({"traceSource":false,"htmlLabels":false})),
    ));
    for direction in ["TB", "BT", "LR", "RL"] {
        for nested in [false, true] {
            let body = "B[Beta]\nC[Gamma]\nA[Entry]\nA ab@-->|next| B\nB --> C\nC --> A";
            let body = if nested {
                format!("subgraph G[Group]\n{body}\nend")
            } else {
                body.to_owned()
            };
            let source = format!(
                "---\nconfig: {}\n---\nflowchart {direction}\n{body}",
                json!({"layout":"elk","elk":{"preset":"legacy","keepEntryNodeOnTop":true}})
            );
            let result = mermaid_trace_rs::render_with(&renderer, "cycle-entry", &source).unwrap();
            let svg = result["svg"].as_str().unwrap();
            let doc = roxmltree::Document::parse(svg).unwrap();
            for (key, role, text) in [
                ("node:A", "node", "A[Entry]"),
                ("edge:ab", "edge", "ab@-->|next|"),
                ("edge:ab", "edge-label", "next"),
            ] {
                let node = doc
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-key") == Some(key)
                            && n.attribute("data-mt-role") == Some(role)
                    })
                    .unwrap();
                let start: usize = node.attribute("data-mt-start").unwrap().parse().unwrap();
                let end: usize = node.attribute("data-mt-end").unwrap().parse().unwrap();
                assert_eq!(&source[start..end], text);
            }
            let reference = mermaid_trace_rs::render_with(&plain, "cycle-entry", &source).unwrap();
            assert_eq!(
                support::strip_trace(svg),
                support::strip_trace(reference["svg"].as_str().unwrap())
            );
            let axis = if direction == "TB" || direction == "BT" {
                1
            } else {
                0
            };
            let sign = if direction == "BT" || direction == "RL" {
                -1.0
            } else {
                1.0
            };
            let a = position(svg, "node:A")[axis] * sign;
            for key in ["node:B", "node:C"] {
                assert!(
                    a < position(svg, key)[axis] * sign,
                    "{direction}/nested={nested}: authored entry A must precede {key}"
                );
            }
        }
    }
}

#[test]
fn flow_ac5_elk_entry_constraints_are_local_and_leave_natural_sources_unchanged() {
    let renderer = mermaid_trace_rs::renderer();
    for body in [
        "B[Beta]\nC[Gamma]\nA[Entry]\nA --> B\nB --> C",
        "B[Beta]\nC[Gamma]\nA[Entry]\nStart --> A\nA --> B\nB --> C\nC --> A",
        "A[Loop]\nA --> A\nB[Isolated]",
    ] {
        let render = |enabled| {
            mermaid_trace_rs::render_with(
                &renderer,
                "entry-control",
                &format!(
                    "---\nconfig: {}\n---\nflowchart TB\n{body}",
                    json!({"layout":"elk","elk":{"keepEntryNodeOnTop":enabled}})
                ),
            )
            .unwrap()
        };
        assert_eq!(
            support::strip_trace(render(false)["svg"].as_str().unwrap()),
            support::strip_trace(render(true)["svg"].as_str().unwrap())
        );
    }
    let source = "---\nconfig: {layout: elk, elk: {keepEntryNodeOnTop: true}}\n---\nflowchart TB\nsubgraph Left\nB[Beta]\nC[Gamma]\nA[Entry]\nA --> B\nB --> C\nC --> A\nend\nsubgraph Right\nE[End]\nF[Final]\nD[Start]\nD --> E\nE --> F\nF --> D\nend\nB --> E";
    let result = mermaid_trace_rs::render_with(&renderer, "entry-scopes", source).unwrap();
    let svg = result["svg"].as_str().unwrap();
    for (entry, others) in [
        ("node:A", ["node:B", "node:C"]),
        ("node:D", ["node:E", "node:F"]),
    ] {
        for other in others {
            assert!(
                position(svg, entry)[1] < position(svg, other)[1],
                "{entry} precedes {other} within its own scope"
            );
        }
    }
}

#[test]
fn flow_ac5_elk_entry_constraint_survives_strategy_and_site_overrides() {
    let renderer = mermaid_trace_rs::renderer();
    let body = "flowchart TB\nsubgraph G[Group]\nB[Beta]\nC[Gamma]\nA[Entry]\nA --> B\nB --> C\nC --> A\nend";
    for (key, values) in [
        (
            "preset",
            vec!["default", "legacy", "modelOrder", "depthFirst"],
        ),
        (
            "cycleBreakingStrategy",
            vec![
                "GREEDY",
                "DEPTH_FIRST",
                "INTERACTIVE",
                "MODEL_ORDER",
                "GREEDY_MODEL_ORDER",
            ],
        ),
        (
            "layeringStrategy",
            vec![
                "NETWORK_SIMPLEX",
                "LONGEST_PATH",
                "LONGEST_PATH_SOURCE",
                "COFFMAN_GRAHAM",
                "MIN_WIDTH",
                "STRETCH_WIDTH",
                "INTERACTIVE",
            ],
        ),
    ] {
        for value in values {
            let mut elk = json!({"preset":"legacy","keepEntryNodeOnTop":true});
            elk[key] = json!(value);
            let config = json!({"layout":"elk","elk":elk,"traceSource":true,"htmlLabels":false});
            let source = format!("---\nconfig: {config}\n---\n{body}");
            let sourced =
                mermaid_trace_rs::render_with(&renderer, "entry-strategy", &source).unwrap();
            let site = merman::Renderer::new().with_engine(
                merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(config)),
            );
            let sited = mermaid_trace_rs::render_with(&site, "entry-strategy", body).unwrap();
            for key in ["node:A", "node:B", "node:C"] {
                assert_eq!(
                    position(sourced["svg"].as_str().unwrap(), key),
                    position(sited["svg"].as_str().unwrap(), key)
                );
            }
            let svg = sourced["svg"].as_str().unwrap();
            for other in ["node:B", "node:C"] {
                assert!(
                    position(svg, "node:A")[1] < position(svg, other)[1],
                    "{key}={value}: A precedes {other}"
                );
            }
        }
    }
}
