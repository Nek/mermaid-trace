mod support;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn edges(svg: &str) -> BTreeMap<String, (String, String)> {
    roxmltree::Document::parse(svg)
        .unwrap()
        .descendants()
        .filter(|n| {
            n.attribute("class")
                .is_some_and(|s| s.split_whitespace().any(|c| c == "flowchart-link"))
        })
        .map(|n| {
            (
                n.attribute("id").unwrap().to_owned(),
                (
                    n.attribute("d").unwrap().to_owned(),
                    n.attribute("data-points").unwrap().to_owned(),
                ),
            )
        })
        .collect()
}

#[test]
fn flow_ac5_elk_line_hops_change_crossing_paths_not_owned_routes() {
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(json!({"traceSource":false,"htmlLabels":false})),
    ));
    for direction in ["TB", "BT", "LR", "RL"] {
        for look in ["classic", "neo", "handDrawn"] {
            for nested in [false, true] {
                let graph = "A[Alpha] --> D\nA --> E\nA e@-->|crossing| F\nB --> D\nB --> E\nB --> F\nC --> D\nC --> E\nC --> F\ne@{curve: basis}";
                let graph = if nested {
                    format!("subgraph Outer\nsubgraph Inner\n{graph}\nend\nend")
                } else {
                    graph.to_owned()
                };
                let render = |mode: Option<Value>, mapped: bool| {
                    let mut elk = json!({});
                    if let Some(mode) = mode {
                        elk["lineHops"] = mode;
                    }
                    let source = format!(
                        "---\nconfig: {}\n---\nflowchart {direction}\n{graph}",
                        json!({"layout":"elk","look":look,"elk":elk})
                    );
                    mermaid_trace_rs::render_with(
                        if mapped { &renderer } else { &plain },
                        "hops",
                        &source,
                    )
                    .unwrap()
                };
                let off = render(Some(json!(false)), true);
                let off_edges = edges(off["svg"].as_str().unwrap());
                let arc = render(Some(json!("arc")), true);
                let arc_edges = edges(arc["svg"].as_str().unwrap());
                assert!(
                    arc_edges.values().any(|(d, _)| d.contains('A')),
                    "missing crossing arcs: {direction}/{look}/nested={nested}"
                );
                assert_ne!(off_edges, arc_edges);
                for (id, (_, points)) in &arc_edges {
                    assert_eq!(points, &off_edges[id].1, "unchanged ports and route points");
                }
                for mode in [None, Some(json!(true))] {
                    assert_eq!(
                        edges(render(mode, true)["svg"].as_str().unwrap()),
                        arc_edges
                    );
                }
                let gap = render(Some(json!("gap")), true);
                let gap_edges = edges(gap["svg"].as_str().unwrap());
                assert!(
                    gap_edges.values().any(|(d, _)| d.matches('M').count() > 1),
                    "missing crossing gaps"
                );
                assert_ne!(gap_edges, arc_edges);
                for mode in [json!(false), json!("arc"), json!("gap")] {
                    let mapped = render(Some(mode.clone()), true);
                    let unmapped = render(Some(mode), false);
                    assert_eq!(
                        support::strip_trace(mapped["svg"].as_str().unwrap()),
                        support::strip_trace(unmapped["svg"].as_str().unwrap())
                    );
                    let svg = roxmltree::Document::parse(mapped["svg"].as_str().unwrap()).unwrap();
                    for (role, expected) in
                        [("edge", "e@-->|crossing|"), ("edge-label", "crossing")]
                    {
                        let n = svg
                            .descendants()
                            .find(|n| {
                                n.attribute("data-mt-key") == Some("edge:e")
                                    && n.attribute("data-mt-role") == Some(role)
                            })
                            .unwrap();
                        let start: usize = n.attribute("data-mt-start").unwrap().parse().unwrap();
                        let end: usize = n.attribute("data-mt-end").unwrap().parse().unwrap();
                        assert_eq!(&mapped["source"].as_str().unwrap()[start..end], expected);
                    }
                }
            }
        }
    }
}

#[test]
fn flow_ac5_line_hops_leave_noncrossing_routes_and_dagre_unchanged() {
    let renderer = mermaid_trace_rs::renderer();
    for layout in ["elk", "dagre"] {
        for look in ["classic", "neo", "handDrawn"] {
            let render = |line_hops: Value| {
                let source = format!(
                    "---\nconfig: {}\n---\nflowchart LR\nA[Alpha] e@-->|next| B[Beta]\nB --> C\nC --> C",
                    json!({"layout":layout,"look":look,"elk":{"lineHops":line_hops}})
                );
                edges(
                    mermaid_trace_rs::render_with(&renderer, "plain", &source).unwrap()["svg"]
                        .as_str()
                        .unwrap(),
                )
            };
            let disabled = render(json!(false));
            for mode in [json!(true), json!("arc"), json!("gap")] {
                assert_eq!(render(mode), disabled);
            }
        }
    }
}
