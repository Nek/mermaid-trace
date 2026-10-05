mod support;
use serde_json::json;

fn geometry(result: &serde_json::Value) -> Vec<(String, String, String)> {
    roxmltree::Document::parse(result["svg"].as_str().unwrap())
        .unwrap()
        .descendants()
        .filter(|node| node.is_element())
        .flat_map(|node| {
            node.attributes().filter_map(move |attr| {
                matches!(
                    attr.name(),
                    "d" | "points" | "transform" | "x" | "y" | "width" | "height" | "viewBox"
                )
                .then(|| {
                    (
                        node.tag_name().name().into(),
                        attr.name().into(),
                        attr.value().into(),
                    )
                })
            })
        })
        .collect()
}

#[test]
fn flow_ac5_elk_presets_match_explicit_recipes_and_keep_source() {
    let body = "flowchart TB\nA[Alpha] --> B[Beta]\nA --> C[Gamma]\nA --> D[Delta]\nB --> E[End]\nC --> E\nD --> E\nA --> E\n";
    let renderer = mermaid_trace_rs::renderer();
    for body in [body.to_owned(), format!("{body}E --> A\n")] {
        for (preset, placement, alignment, cycle) in [
            ("default", "BRANDES_KOEPF", "BALANCED", "DEPTH_FIRST"),
            ("legacy", "BRANDES_KOEPF", "NONE", "GREEDY"),
            (
                "modelOrder",
                "NETWORK_SIMPLEX",
                "NONE",
                "GREEDY_MODEL_ORDER",
            ),
            ("depthFirst", "NETWORK_SIMPLEX", "NONE", "DEPTH_FIRST"),
        ] {
            let recipe = json!({"nodePlacementStrategy": placement, "nodePlacementAlignment": alignment, "cycleBreakingStrategy": cycle});
            for overrides in [
                json!({}),
                json!({"nodePlacementStrategy":"SIMPLE"}),
                json!({"nodePlacementAlignment":"NONE"}),
                json!({"cycleBreakingStrategy":"GREEDY"}),
                json!({"nodePlacementStrategy":"SIMPLE", "nodePlacementAlignment":"NONE", "cycleBreakingStrategy":"GREEDY"}),
            ] {
                let mut recipe = recipe.clone();
                recipe
                    .as_object_mut()
                    .unwrap()
                    .extend(overrides.as_object().unwrap().clone());
                let mut options = json!({"preset":preset});
                options
                    .as_object_mut()
                    .unwrap()
                    .extend(overrides.as_object().unwrap().clone());
                let expanded = format!(
                    "---\nconfig: {}\n---\n{body}",
                    json!({"layout":"elk", "elk":recipe})
                );
                let expected =
                    mermaid_trace_rs::render_with(&renderer, "preset", &expanded).unwrap();
                let source = format!(
                    "---\nconfig: {}\n---\n{body}",
                    json!({"layout":"elk", "elk":options})
                );
                let actual = mermaid_trace_rs::render_with(&renderer, "preset", &source).unwrap();
                assert_eq!(
                    geometry(&actual),
                    geometry(&expected),
                    "{preset}: preset must apply its recipe"
                );
                assert_eq!(actual["source"], source);
                let label = actual["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|piece| piece["kind"] == "node" && piece["domId"] == "node:A")
                    .unwrap();
                let span = &label["labelSpan"];
                assert_eq!(
                    &source[span["start"].as_u64().unwrap() as usize
                        ..span["end"].as_u64().unwrap() as usize],
                    "Alpha"
                );
            }
        }
    }
}

#[test]
fn flow_ac5_elk_presets_keep_nested_source_site_precedence_and_default_geometry() {
    let body = "flowchart LR\nsubgraph G[Group]\nsubgraph Inner\nA[Alpha] --> B[Beta]\nB --> C[Gamma]\nC --> A\nend\nend\nA --> D[Delta]\nB --> D\nD --> E[End]\nC --> E\n";
    let engine = merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(
        json!({"traceSource":true,"htmlLabels":false,"layout":"elk"}),
    ));
    for preset in ["default", "legacy", "modelOrder", "depthFirst"] {
        for overrides in [
            json!({}),
            json!({"nodePlacementStrategy":"SIMPLE", "nodePlacementAlignment":"NONE", "cycleBreakingStrategy":"GREEDY"}),
        ] {
            let site = engine
                .clone()
                .with_site_config(merman::MermaidConfig::from_value(json!({"elk":overrides})));
            let mut options = json!({"preset":preset});
            options
                .as_object_mut()
                .unwrap()
                .extend(overrides.as_object().unwrap().clone());
            let source = format!(
                "---\nconfig: {}\n---\n{body}",
                json!({"elk":{"preset":preset}})
            );
            let mixed = mermaid_trace_rs::render_with(
                &merman::Renderer::new().with_engine(site),
                "nested",
                &source,
            )
            .unwrap();
            let complete_source = format!("---\nconfig: {}\n---\n{body}", json!({"elk":options}));
            let sourced = mermaid_trace_rs::render_with(
                &merman::Renderer::new().with_engine(engine.clone()),
                "nested",
                &complete_source,
            )
            .unwrap();
            let sited_engine = engine
                .clone()
                .with_site_config(merman::MermaidConfig::from_value(json!({"elk":options})));
            let sited = mermaid_trace_rs::render_with(
                &merman::Renderer::new().with_engine(sited_engine.clone()),
                "nested",
                body,
            )
            .unwrap();
            assert_eq!(
                geometry(&mixed),
                geometry(&sourced),
                "{preset}: explicit site fields override source preset defaults"
            );
            assert_eq!(
                geometry(&sited),
                geometry(&sourced),
                "{preset}: source/site recipe equivalence"
            );
            let plain = mermaid_trace_rs::render_with(
                &merman::Renderer::new().with_engine(sited_engine.with_site_config(
                    merman::MermaidConfig::from_value(json!({"traceSource":false})),
                )),
                "nested",
                body,
            )
            .unwrap();
            assert_eq!(
                support::strip_trace(sited["svg"].as_str().unwrap()),
                support::strip_trace(plain["svg"].as_str().unwrap())
            );
            assert_eq!(mixed["source"], source);
        }
    }
    let ordinary = mermaid_trace_rs::render_with(
        &merman::Renderer::new().with_engine(engine.clone()),
        "nested",
        body,
    )
    .unwrap();
    let legacy = mermaid_trace_rs::render_with(
        &merman::Renderer::new().with_engine(engine.with_site_config(
            merman::MermaidConfig::from_value(json!({"elk":{"preset":"legacy"}})),
        )),
        "nested",
        body,
    )
    .unwrap();
    assert_eq!(
        geometry(&ordinary),
        geometry(&legacy),
        "omitted preset preserves the native legacy defaults"
    );
}
