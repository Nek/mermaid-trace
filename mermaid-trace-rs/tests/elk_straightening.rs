mod support;
use serde_json::json;

#[test]
fn flow_ac5_elk_straightening_removes_short_terminal_step() {
    let renderer = mermaid_trace_rs::renderer();
    let render = |enabled: Option<bool>| {
        let mut elk = json!({"lineHops":false});
        if let Some(enabled) = enabled {
            elk["straightenEdges"] = json!(enabled);
        }
        let source = format!(
            "---\nconfig: {}\n---\nflowchart TB\nA --> D\nA --> E\nA --> F\nB --> D\nB --> E\nB --> F\nC e@--> D\nC --> E\nC --> F",
            json!({"layout":"elk","elk":elk})
        );
        mermaid_trace_rs::render_with(&renderer, "straight", &source).unwrap()
    };
    let path = |result: &serde_json::Value| {
        let xml = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        xml.descendants()
            .find(|n| {
                n.attribute("data-mt-key") == Some("edge:e")
                    && n.attribute("data-mt-role") == Some("edge")
            })
            .unwrap()
            .attribute("d")
            .unwrap()
            .to_owned()
    };
    let off = render(Some(false));
    let on = render(Some(true));
    assert_eq!(
        path(&render(None)),
        path(&on),
        "straightening is enabled by default"
    );
    assert_eq!(
        path(&off).matches('Q').count(),
        4,
        "the witness must have the terminal step"
    );
    assert_eq!(
        path(&on).matches('Q').count(),
        2,
        "remove the step while retaining the two genuine turns"
    );
}

#[test]
fn flow_ac5_straightening_preserves_shapes_ports_labels_and_source_across_variants() {
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(json!({"traceSource":false,"htmlLabels":false})),
    ));
    for direction in ["TB", "BT", "LR", "RL"] {
        for shape in ["C[C]\nD[D]", "C((C))\nD((D))", "C{C}\nD{D}"] {
            for nested in [false, true] {
                for look in ["classic", "neo"] {
                    let graph = format!(
                        "{shape}\nA[Alpha] --> D\nA --> E\nA --> F\nB --> D\nB --> E\nB --> F\nC e@-->|route| D\nC --> E\nC --> F"
                    );
                    let graph = if nested {
                        format!("subgraph Outer\nsubgraph Inner\n{graph}\nend\nend")
                    } else {
                        graph
                    };
                    let source = |enabled| {
                        format!(
                            "---\nconfig: {}\n---\nflowchart {direction}\n{graph}",
                            json!({"layout":"elk","look":look,"elk":{"straightenEdges":enabled,"lineHops":false}})
                        )
                    };
                    let off =
                        mermaid_trace_rs::render_with(&renderer, "ports", &source(false)).unwrap();
                    let on =
                        mermaid_trace_rs::render_with(&renderer, "ports", &source(true)).unwrap();
                    let paths = |result: &serde_json::Value| {
                        roxmltree::Document::parse(result["svg"].as_str().unwrap())
                            .unwrap()
                            .descendants()
                            .filter(|n| n.attribute("data-mt-role") == Some("edge"))
                            .map(|n| {
                                (
                                    n.attribute("data-mt-key").unwrap().to_owned(),
                                    n.attribute("d").unwrap().to_owned(),
                                )
                            })
                            .collect::<std::collections::BTreeMap<_, _>>()
                    };
                    let mut after_paths = paths(&on);
                    for (key, before) in paths(&off) {
                        let after = after_paths.remove(&key).unwrap();
                        assert_eq!(
                            before.split('L').next(),
                            after.split('L').next(),
                            "source port: {direction}/{shape}/{nested}/{key}"
                        );
                        assert_eq!(
                            before.rsplit('L').next(),
                            after.rsplit('L').next(),
                            "target port: {direction}/{shape}/{nested}/{key}"
                        );
                    }
                    let reference =
                        mermaid_trace_rs::render_with(&plain, "ports", &source(true)).unwrap();
                    assert_eq!(
                        support::strip_trace(on["svg"].as_str().unwrap()),
                        support::strip_trace(reference["svg"].as_str().unwrap())
                    );
                    let xml = roxmltree::Document::parse(on["svg"].as_str().unwrap()).unwrap();
                    for (role, text) in [("edge", "e@-->|route|"), ("edge-label", "route")] {
                        let n = xml
                            .descendants()
                            .find(|n| {
                                n.attribute("data-mt-key") == Some("edge:e")
                                    && n.attribute("data-mt-role") == Some(role)
                            })
                            .unwrap();
                        let start: usize = n.attribute("data-mt-start").unwrap().parse().unwrap();
                        let end: usize = n.attribute("data-mt-end").unwrap().parse().unwrap();
                        assert_eq!(&on["source"].as_str().unwrap()[start..end], text);
                    }
                }
            }
        }
    }
}
