mod support;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const BRANCHES: &str = "A[Alpha] ab@-->|next| B[Longer beta]\nA ac@--> C[Gamma]\nA ad@--> D[Delta]\nB --> E[End]\nC --> E\nD --> E\nA ae@--> E";
const NESTED_CYCLE: &str = "subgraph G[Group]\nA[Entry] --> B[Beta]\nB --> C[Gamma]\nC --> A\nend\nA --> D[Delta]\nB --> D\nD --> E[End]\nC --> E";
const STRATEGIES: [&str; 4] = [
    "SIMPLE",
    "NETWORK_SIMPLEX",
    "LINEAR_SEGMENTS",
    "BRANDES_KOEPF",
];
const ALIGNMENTS: [&str; 6] = [
    "NONE",
    "LEFTUP",
    "LEFTDOWN",
    "RIGHTUP",
    "RIGHTDOWN",
    "BALANCED",
];

fn source(body: &str, direction: &str, options: Value) -> String {
    let mut elk = json!({"preset":"legacy","lineHops":false});
    elk.as_object_mut()
        .unwrap()
        .extend(options.as_object().unwrap().clone());
    format!(
        "---\nconfig: {}\n---\nflowchart {direction}\n{body}",
        json!({"layout":"elk","elk":elk})
    )
}
fn nodes(result: &Value) -> BTreeMap<String, String> {
    roxmltree::Document::parse(result["svg"].as_str().unwrap())
        .unwrap()
        .descendants()
        .filter(|n| n.attribute("data-mt-role") == Some("node"))
        .map(|n| {
            (
                n.attribute("data-mt-key").unwrap().to_owned(),
                n.attribute("transform").unwrap().to_owned(),
            )
        })
        .collect()
}

#[test]
fn flow_ac5_elk_merging_shares_ports_without_merging_connector_ownership() {
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(json!({"traceSource":false,"htmlLabels":false})),
    ));
    for direction in ["TB", "BT", "LR", "RL"] {
        for nested in [false, true] {
            for strategy in STRATEGIES {
                for merge in [false, true] {
                    let body = if nested {
                        format!("subgraph Outer\nsubgraph Inner\n{BRANCHES}\nend\nend")
                    } else {
                        BRANCHES.to_owned()
                    };
                    let source = source(
                        &body,
                        direction,
                        json!({"mergeEdges":merge,"nodePlacementStrategy":strategy}),
                    );
                    let result =
                        mermaid_trace_rs::render_with(&renderer, "merge", &source).unwrap();
                    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                    let mut ports = BTreeSet::new();
                    for (key, text) in [
                        ("ab", "ab@-->|next|"),
                        ("ac", "ac@-->"),
                        ("ad", "ad@-->"),
                        ("ae", "ae@-->"),
                    ] {
                        let node = svg
                            .descendants()
                            .find(|n| {
                                n.attribute("data-mt-key") == Some(format!("edge:{key}").as_str())
                                    && n.attribute("data-mt-role") == Some("edge")
                            })
                            .unwrap();
                        ports.insert(
                            node.attribute("d")
                                .unwrap()
                                .split('L')
                                .next()
                                .unwrap()
                                .to_owned(),
                        );
                        let start: usize =
                            node.attribute("data-mt-start").unwrap().parse().unwrap();
                        let end: usize = node.attribute("data-mt-end").unwrap().parse().unwrap();
                        assert_eq!(&source[start..end], text);
                    }
                    assert_eq!(
                        ports.len(),
                        if merge { 1 } else { 4 },
                        "{direction}/{nested}/{strategy}/merge={merge}"
                    );
                    assert_eq!(
                        svg.descendants()
                            .filter(|n| n.attribute("data-mt-role") == Some("edge"))
                            .count(),
                        7
                    );
                    let label = svg
                        .descendants()
                        .find(|n| {
                            n.attribute("data-mt-key") == Some("edge:ab")
                                && n.attribute("data-mt-role") == Some("edge-label")
                        })
                        .unwrap();
                    let start: usize = label.attribute("data-mt-start").unwrap().parse().unwrap();
                    let end: usize = label.attribute("data-mt-end").unwrap().parse().unwrap();
                    assert_eq!(&source[start..end], "next");
                    let reference =
                        mermaid_trace_rs::render_with(&plain, "merge", &source).unwrap();
                    assert_eq!(
                        support::strip_trace(result["svg"].as_str().unwrap()),
                        support::strip_trace(reference["svg"].as_str().unwrap())
                    );
                }
            }
        }
    }
}

#[test]
fn flow_ac5_elk_placement_strategies_have_distinct_nested_geometry() {
    let renderer = mermaid_trace_rs::renderer();
    let mut placements = BTreeSet::new();
    for strategy in STRATEGIES {
        let result = mermaid_trace_rs::render_with(
            &renderer,
            "placement",
            &source(
                NESTED_CYCLE,
                "LR",
                json!({"nodePlacementStrategy":strategy}),
            ),
        )
        .unwrap();
        placements.insert(nodes(&result));
    }
    assert_eq!(
        placements.len(),
        4,
        "each strategy must reach the actual nested layout"
    );
}

#[test]
fn flow_ac5_elk_alignment_affects_only_brandes_koepf_and_matches_site_configuration() {
    let renderer = mermaid_trace_rs::renderer();
    for strategy in STRATEGIES {
        let mut geometries = BTreeSet::new();
        for alignment in ALIGNMENTS {
            let options = json!({"preset":"legacy","lineHops":false,"nodePlacementStrategy":strategy,"nodePlacementAlignment":alignment});
            let sourced = mermaid_trace_rs::render_with(
                &renderer,
                "alignment",
                &source(BRANCHES, "TB", options.clone()),
            )
            .unwrap();
            geometries.insert(nodes(&sourced));
            let site = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
                merman::MermaidConfig::from_value(
                    json!({"traceSource":true,"htmlLabels":false,"layout":"elk","elk":options}),
                ),
            ));
            let sited = mermaid_trace_rs::render_with(
                &site,
                "alignment",
                &format!("flowchart TB\n{BRANCHES}"),
            )
            .unwrap();
            assert_eq!(nodes(&sourced), nodes(&sited));
        }
        assert_eq!(
            geometries.len(),
            if strategy == "BRANDES_KOEPF" { 5 } else { 1 },
            "{strategy}: alignment effect/invariance"
        );
    }
}
