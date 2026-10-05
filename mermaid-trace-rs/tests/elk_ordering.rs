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

fn configured(body: &str, direction: &str, options: serde_json::Value) -> String {
    let mut elk = json!({"preset":"legacy"});
    elk.as_object_mut()
        .unwrap()
        .extend(options.as_object().unwrap().clone());
    format!(
        "---\nconfig: {}\n---\nflowchart {direction}\n{body}",
        json!({"layout":"elk","elk":elk})
    )
}

#[test]
fn flow_ac5_elk_model_order_resolves_conflicting_node_and_edge_declarations() {
    let renderer = mermaid_trace_rs::renderer();
    for labelled in [false, true] {
        // Equal-size nodes isolate layer order from measured-center alignment.
        let body = "S[Start]\nA[Same]\nB[Same]\nC[Same]\nS sc@-->|route| C\nS --> B\nS --> A";
        let body = if labelled {
            body.to_owned()
        } else {
            body.replace("sc@-->|route|", "sc@-->")
        };
        for direction in ["TB", "BT", "LR", "RL"] {
            for mode in ["NONE", "NODES_AND_EDGES", "PREFER_EDGES", "PREFER_NODES"] {
                for force in [false, true] {
                    let options = json!({"considerModelOrder":mode,"forceNodeModelOrder":force});
                    let source = configured(&body, direction, options.clone());
                    let result =
                        mermaid_trace_rs::render_with(&renderer, "model-order", &source).unwrap();
                    let svg = result["svg"].as_str().unwrap();
                    let axis = if direction == "TB" || direction == "BT" {
                        0
                    } else {
                        1
                    };
                    // A labeled edge reserves another layer for C; ordering is within a layer.
                    let rank_axis = 1 - axis;
                    assert_eq!(
                        position(svg, "node:A")[rank_axis],
                        position(svg, "node:B")[rank_axis]
                    );
                    assert_eq!(
                        position(svg, "node:A")[rank_axis] == position(svg, "node:C")[rank_axis],
                        !labelled
                    );
                    let mut order = if labelled {
                        vec!["node:A", "node:B"]
                    } else {
                        vec!["node:A", "node:B", "node:C"]
                    };
                    order.sort_by(|a, b| position(svg, a)[axis].total_cmp(&position(svg, b)[axis]));
                    if mode != "NONE" || force {
                        let expected = if mode == "PREFER_NODES" || force && mode != "PREFER_EDGES"
                        {
                            if labelled {
                                vec!["node:A", "node:B"]
                            } else {
                                vec!["node:A", "node:B", "node:C"]
                            }
                        } else {
                            if labelled {
                                vec!["node:B", "node:A"]
                            } else {
                                vec!["node:C", "node:B", "node:A"]
                            }
                        };
                        assert_eq!(order, expected, "{direction}/{mode}/force={force}");
                    } else if !labelled {
                        assert_ne!(
                            order,
                            vec!["node:C", "node:B", "node:A"],
                            "NONE disables model-order tie breaking on this fan witness"
                        );
                    }
                    let site = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(json!({"layout":"elk","traceSource":true,"htmlLabels":false,"elk":{"preset":"legacy","considerModelOrder":mode,"forceNodeModelOrder":force}}))));
                    let sited = mermaid_trace_rs::render_with(
                        &site,
                        "model-order",
                        &format!("flowchart {direction}\n{body}"),
                    )
                    .unwrap();
                    for key in ["node:S", "node:A", "node:B", "node:C"] {
                        assert_eq!(
                            position(svg, key),
                            position(sited["svg"].as_str().unwrap(), key)
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn flow_ac5_elk_forced_node_order_preserves_crossings_instead_of_reordering_nodes() {
    let renderer = mermaid_trace_rs::renderer();
    let body = "S\nA\nB\nC\nD\nT\nS --> A\nS --> B\nA --> D\nB --> C\nC --> T\nD --> T";
    for mode in ["NONE", "NODES_AND_EDGES", "PREFER_EDGES", "PREFER_NODES"] {
        for force in [false, true] {
            let source = configured(
                body,
                "TB",
                json!({"considerModelOrder":mode,"forceNodeModelOrder":force}),
            );
            let result =
                mermaid_trace_rs::render_with(&renderer, "crossing-order", &source).unwrap();
            let svg = result["svg"].as_str().unwrap();
            assert!(position(svg, "node:A")[0] < position(svg, "node:B")[0]);
            assert_eq!(
                position(svg, "node:C")[0] < position(svg, "node:D")[0],
                force && mode != "PREFER_EDGES",
                "{mode}/force={force}"
            );
        }
    }
}

#[test]
fn flow_ac5_elk_cycle_breaking_strategies_choose_feedback_routes_without_reversing_source() {
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(json!({"traceSource":false,"htmlLabels":false})),
    ));
    for equal_width in [false, true] {
        for direction in ["TB", "BT", "LR", "RL"] {
            for nested in [false, true] {
                for strategy in [
                    "GREEDY",
                    "DEPTH_FIRST",
                    "INTERACTIVE",
                    "MODEL_ORDER",
                    "GREEDY_MODEL_ORDER",
                ] {
                    let body = "A\nB\nC\nD\nA ab@-->|route| B\nB --> C\nC --> A\nB --> D\nD --> A";
                    let body = if equal_width {
                        body.replacen("A\nB\nC\nD", "A[Same]\nB[Same]\nC[Same]\nD[Same]", 1)
                    } else {
                        body.to_owned()
                    };
                    let body = if nested {
                        format!("subgraph G[Group]\n{body}\nend")
                    } else {
                        body.to_owned()
                    };
                    let source =
                        configured(&body, direction, json!({"cycleBreakingStrategy":strategy}));
                    let result =
                        mermaid_trace_rs::render_with(&renderer, "cycle-order", &source).unwrap();
                    let svg = result["svg"].as_str().unwrap();
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
                    let a_first =
                        position(svg, "node:A")[axis] * sign < position(svg, "node:B")[axis] * sign;
                    // Interactive compares measured centers, so unequal-width input may choose another entry.
                    if equal_width || strategy != "INTERACTIVE" {
                        assert_eq!(
                            a_first,
                            !matches!(strategy, "GREEDY" | "GREEDY_MODEL_ORDER"),
                            "{direction}/{nested}/{strategy}"
                        );
                    }
                    let doc = roxmltree::Document::parse(svg).unwrap();
                    let edge = doc
                        .descendants()
                        .find(|n| {
                            n.attribute("data-mt-role") == Some("edge")
                                && n.attribute("data-mt-key") == Some("edge:ab")
                        })
                        .unwrap();
                    let start: usize = edge.attribute("data-mt-start").unwrap().parse().unwrap();
                    let end: usize = edge.attribute("data-mt-end").unwrap().parse().unwrap();
                    assert_eq!(&source[start..end], "ab@-->|route|");
                    assert!(
                        edge.attribute("marker-end").is_some(),
                        "layout feedback must retain the authored target arrow"
                    );
                    assert!(edge.attribute("marker-start").is_none());
                    let d = edge.attribute("d").unwrap();
                    let point = |text: &str| -> [f64; 2] {
                        let values: Vec<f64> = text
                            .trim_start_matches('M')
                            .split(',')
                            .map(|n| n.trim().parse().unwrap())
                            .collect();
                        [values[0], values[1]]
                    };
                    let distance = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).hypot(a[1] - b[1]);
                    let first = point(d.split('L').next().unwrap());
                    let last = point(d.rsplit('L').next().unwrap());
                    let a = position(svg, "node:A");
                    let b = position(svg, "node:B");
                    assert!(
                        distance(first, a) < distance(first, b),
                        "authored A remains the connector source"
                    );
                    assert!(
                        distance(last, b) < distance(last, a),
                        "authored B remains the connector target"
                    );

                    let reference =
                        mermaid_trace_rs::render_with(&plain, "cycle-order", &source).unwrap();
                    assert_eq!(
                        support::strip_trace(svg),
                        support::strip_trace(reference["svg"].as_str().unwrap())
                    );
                }
            }
        }
    }
}

#[test]
fn flow_ac5_elk_cycle_strategies_respect_model_order_and_independent_components() {
    let renderer = mermaid_trace_rs::renderer();
    for strategy in [
        "GREEDY",
        "DEPTH_FIRST",
        "INTERACTIVE",
        "MODEL_ORDER",
        "GREEDY_MODEL_ORDER",
    ] {
        let source = configured(
            "C\nA\nB\nD\nE\nF\nA --> B\nB --> C\nC --> A\nD --> E\nE --> F\nF --> D",
            "TB",
            json!({"cycleBreakingStrategy":strategy}),
        );
        let result = mermaid_trace_rs::render_with(&renderer, "components", &source).unwrap();
        let svg = result["svg"].as_str().unwrap();
        // Greedy's seeded tie differs from model order on two independent cycles.
        assert_eq!(
            position(svg, "node:A")[1] < position(svg, "node:C")[1],
            strategy == "GREEDY",
            "{strategy}"
        );
        assert!(position(svg, "node:D")[1] < position(svg, "node:E")[1]);
        assert!(position(svg, "node:E")[1] < position(svg, "node:F")[1]);
        let source = configured(
            "A\nB\nB --> A",
            "TB",
            json!({"cycleBreakingStrategy":strategy}),
        );
        let result =
            mermaid_trace_rs::render_with(&renderer, "reverse-declarations", &source).unwrap();
        let svg = result["svg"].as_str().unwrap();
        assert_eq!(
            position(svg, "node:A")[1] < position(svg, "node:B")[1],
            strategy == "MODEL_ORDER",
            "only model order puts A first against the edge direction: {strategy}"
        );
    }
}

#[test]
fn flow_ac5_elk_model_order_options_do_not_leak_into_container_local_layouts() {
    let renderer = mermaid_trace_rs::renderer();
    let body = "subgraph G[Group]\nS\nA\nB\nC\nS --> C\nS --> B\nS --> A\nend";
    let baseline = mermaid_trace_rs::render_with(
        &renderer,
        "ordering-scope",
        &configured(body, "TB", json!({})),
    )
    .unwrap();
    // Pinned Mermaid passes these options to the root only, unlike cycle breaking.
    for mode in ["NONE", "NODES_AND_EDGES", "PREFER_EDGES", "PREFER_NODES"] {
        for force in [false, true] {
            let source = configured(
                body,
                "TB",
                json!({"considerModelOrder":mode,"forceNodeModelOrder":force}),
            );
            let result =
                mermaid_trace_rs::render_with(&renderer, "ordering-scope", &source).unwrap();
            assert_eq!(
                support::strip_trace(result["svg"].as_str().unwrap()),
                support::strip_trace(baseline["svg"].as_str().unwrap()),
                "{mode}/force={force}"
            );
        }
    }
}
