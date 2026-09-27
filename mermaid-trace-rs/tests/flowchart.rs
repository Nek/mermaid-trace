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
    let repeated =
        mermaid_trace_rs::render("flow-repeat", "flowchart LR\nA[x]\nA[y] --> B").unwrap();
    let effective = repeated["mapping"]["pieces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["domId"] == "node:A" && p["effective"] == true)
        .unwrap();
    assert_eq!(effective["span"], serde_json::json!({"start":18,"end":22}));
    assert_eq!(
        effective["labelSpan"],
        serde_json::json!({"start":20,"end":21})
    );
}

#[test]
fn flow_ac4_subgraph_frames_and_titles_have_native_original_ranges() {
    for header in ["graph", "flowchart"] {
        for html in [false, true] {
            let block = "subgraph G[\"Same 😀\"]\r\nsubgraph \"Same 😀\"\r\nA[Actor] -->|go| B\r\nend\r\nend";
            let source = format!(
                "---\r\ntitle: \"Whole 😀\"\r\nconfig:\r\n  htmlLabels: {html}\r\n---\r\n{header} LR\r\n{block}\r\n"
            );
            let result = mermaid_trace_rs::render("flow-groups", &source).unwrap();
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            let text: Vec<_> = source.encode_utf16().collect();
            let selected = |span: &Value| {
                String::from_utf16(
                    &text[span["start"].as_u64().unwrap() as usize
                        ..span["end"].as_u64().unwrap() as usize],
                )
                .unwrap()
            };
            let group = pieces
                .iter()
                .find(|p| p["domId"] == "flowchart:subgraph:G")
                .expect("native subgraph frame mapping");
            assert_eq!(selected(&group["span"]), block);
            assert_eq!(selected(&group["labelSpan"]), "Same 😀");
            let anonymous = pieces
                .iter()
                .find(|p| p["domId"] == "flowchart:subgraph:subGraph0")
                .expect("native anonymous subgraph identity");
            assert_eq!(
                selected(&anonymous["span"]),
                "subgraph \"Same 😀\"\r\nA[Actor] -->|go| B\r\nend"
            );
            assert_eq!(selected(&anonymous["labelSpan"]), "Same 😀");
            assert_ne!(group["labelSpan"], anonymous["labelSpan"]);
            let title = pieces
                .iter()
                .find(|p| p["domId"] == "flowchart:title")
                .expect("frontmatter title mapping");
            assert_eq!(selected(&title["span"]), "title: \"Whole 😀\"");
            assert_eq!(selected(&title["labelSpan"]), "Whole 😀");
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            for key in [
                "flowchart:subgraph:G",
                "flowchart:subgraph:subGraph0",
                "flowchart:title",
            ] {
                assert!(
                    svg.descendants()
                        .any(|n| n.attribute("data-mt-key") == Some(key)
                            && n.attribute("data-mt-role") == Some("control-label")),
                    "{key}/{html}"
                );
            }
            for (key, role) in [("node:A", "node-label"), ("edge:L_A_B_0", "edge-label")] {
                assert!(
                    svg.descendants().any(|n| n
                        .ancestors()
                        .any(|a| a.attribute("data-mt-key") == Some(key))
                        && n.attribute("data-mt-role") == Some(role)),
                    "missing {key}/{html}"
                );
            }
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline = mermaid_trace_rs::render_with(&plain, "flow-groups", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
}

#[test]
fn flow_ac5_elk_and_math_render_without_a_browser_and_preserve_source() {
    for (name, source, label) in [
        (
            "flow-elk-header",
            "flowchart-elk LR\nsubgraph G[Group]\nA[Actor] --> B\nend\n",
            "Actor",
        ),
        (
            "flow-elk-config",
            "---\nconfig:\n  layout: elk\n---\nflowchart LR\nsubgraph G[Group]\nA[Actor] --> B\nend\n",
            "Actor",
        ),
        (
            "flow-math",
            "flowchart LR\nA[\"$$x^2$$\"] -->|\"$$\\sqrt{x}$$\"| B\n",
            "$$x^2$$",
        ),
    ] {
        let result =
            mermaid_trace_rs::render(name, source).expect("required native renderer capability");
        let pieces = result["mapping"]["pieces"].as_array().unwrap();
        let a = pieces.iter().find(|p| p["domId"] == "node:A").unwrap();
        let span = &a["labelSpan"];
        assert_eq!(
            &source
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
            label
        );
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        assert!(
            svg.descendants()
                .any(|n| n.attribute("data-mt-role") == Some("node-label")
                    && n.ancestors()
                        .any(|a| a.attribute("data-mt-key") == Some("node:A"))),
            "missing {name} node label"
        );
        if name.contains("elk") {
            assert!(
                svg.descendants().any(|n| n.attribute("data-mt-key")
                    == Some("flowchart:subgraph:G")
                    && n.attribute("data-mt-role") == Some("control")),
                "missing native ELK subgraph mapping"
            );
        }
        let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
        let baseline = mermaid_trace_rs::render_with(&plain, name, source).unwrap();
        assert_eq!(
            strip_trace(result["svg"].as_str().unwrap()),
            strip_trace(baseline["svg"].as_str().unwrap())
        );
    }
}

#[test]
fn flow_ac5_html_math_keeps_formula_geometry_and_source_selection() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        let source = format!(
            "---\nconfig:\n  htmlLabels: true\n---\n{header}\nA[\"before $$x^2$$ after<br/>$$\\frac{{1}}{{2}}$$\"] -->|\"$$\\sqrt{{x}}$$\"| B\n"
        );
        let result = mermaid_trace_rs::render("flow-formulas", &source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        for key in ["node:A", "edge:L_A_B_0"] {
            let label = svg
                .descendants()
                .find(|n| {
                    n.attribute("data-mt-key") == Some(key)
                        && n.attribute("data-mt-role")
                            .is_some_and(|role| role.ends_with("-label"))
                })
                .expect("formula label remains selectable");
            assert!(
                label
                    .descendants()
                    .any(|n| n.has_tag_name("svg")
                        && n.descendants().any(|p| p.has_tag_name("path"))),
                "formula geometry was dropped for {key}"
            );
        }
        assert!(!svg.descendants().any(|n| n.has_tag_name("foreignObject")));
        let a = result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["domId"] == "node:A")
            .unwrap();
        let span = &a["labelSpan"];
        assert_eq!(
            &source
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
            "before $$x^2$$ after<br/>$$\\frac{1}{2}$$"
        );
        let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
        let baseline = mermaid_trace_rs::render_with(&plain, "flow-formulas", &source).unwrap();
        assert_eq!(
            strip_trace(result["svg"].as_str().unwrap()),
            strip_trace(baseline["svg"].as_str().unwrap())
        );
    }
}

#[test]
fn flow_ac5_pinned_math_inventory_retains_every_formula_label() {
    let fixtures = std::path::Path::new("vendor/merman/fixtures/flowchart");
    let files: Vec<_> = std::fs::read_dir(fixtures)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.extension().is_some_and(|extension| extension == "mmd")
                && (path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains("katex")
                    || path
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .contains("math_flowcharts"))
        })
        .collect();
    assert_eq!(
        files.len(),
        5,
        "refresh the pinned math inventory explicitly"
    );
    for file in files {
        let source = format!(
            "---\nconfig:\n  htmlLabels: true\n---\n{}",
            std::fs::read_to_string(&file).unwrap()
        );
        let result = mermaid_trace_rs::render("formula-corpus", &source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        for piece in result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["labelSpan"].is_object())
        {
            let span = &piece["labelSpan"];
            let text = &source
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize];
            if !text.contains("$$") {
                continue;
            }
            let key = piece["domId"].as_str().unwrap();
            let label = svg
                .descendants()
                .find(|n| {
                    n.attribute("data-mt-key") == Some(key)
                        && n.attribute("data-mt-role")
                            .is_some_and(|role| role.ends_with("-label"))
                })
                .unwrap();
            assert!(
                label
                    .descendants()
                    .any(|n| n.has_tag_name("svg")
                        && n.descendants().any(|p| p.has_tag_name("path"))),
                "missing native formula geometry: {} {key}",
                file.display()
            );
        }
        assert!(!svg.descendants().any(|n| n.has_tag_name("foreignObject")));
    }
}

#[test]
fn flow_ac4_repeated_declarations_keep_native_effective_origin_and_all_occurrences() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            for final_label in ["Same 😀", ""] {
                let declaration = format!("A[\"{final_label}\"]");
                let source = format!(
                    "---\r\nconfig:\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\nA[\"Old 😀\"]\r\nA[\"Same 😀\"]\r\n{declaration} --> B\r\nA --> B\r\n"
                );
                let result = mermaid_trace_rs::render("replaced-label", &source)
                    .expect("valid repeated declarations must render");
                let pieces: Vec<_> = result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|p| p["domId"] == "node:A")
                    .collect();
                assert_eq!(pieces.len(), 4);
                assert_eq!(pieces.iter().filter(|p| p["effective"] == true).count(), 1);
                assert_eq!(
                    pieces[2]["effective"], true,
                    "native last label must win even when text repeats"
                );
                let text: Vec<_> = source.encode_utf16().collect();
                let slice =
                    |start: usize, end: usize| String::from_utf16(&text[start..end]).unwrap();
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let node = svg
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-key") == Some("node:A")
                            && n.attribute("data-mt-role") == Some("node")
                    })
                    .unwrap();
                assert_eq!(
                    slice(
                        node.attribute("data-mt-start").unwrap().parse().unwrap(),
                        node.attribute("data-mt-end").unwrap().parse().unwrap()
                    ),
                    declaration
                );
                assert_eq!(
                    node.attribute("data-mt-refs")
                        .unwrap()
                        .split_whitespace()
                        .count(),
                    4
                );
                let label = svg.descendants().find(|n| {
                    n.attribute("data-mt-role") == Some("node-label")
                        && n.ancestors()
                            .any(|a| a.attribute("data-mt-key") == Some("node:A"))
                });
                if final_label.is_empty() {
                    assert!(
                        label.is_none(),
                        "an empty label has no fabricated text range"
                    );
                } else {
                    let label = label.unwrap();
                    assert_eq!(label.attribute("data-mt-refs"), pieces[2]["id"].as_str());
                    assert_eq!(
                        slice(
                            label.attribute("data-mt-start").unwrap().parse().unwrap(),
                            label.attribute("data-mt-end").unwrap().parse().unwrap()
                        ),
                        final_label
                    );
                }
                let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "replaced-label", &source).unwrap();
                assert_eq!(
                    strip_trace(result["svg"].as_str().unwrap()),
                    strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn flow_ac5_legacy_ellipse_syntax_renders_native_geometry_and_exact_ranges() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            for look in ["classic", "handDrawn"] {
                let source = format!(
                    "---\nconfig:\n  htmlLabels: {html}\n  look: {look}\n  handDrawnSeed: 42\n---\n{header}\nA(-Café 😀-) -->|go| B\n"
                );
                let result = mermaid_trace_rs::render("ellipse-native", &source)
                    .expect("accepted ellipse syntax must render");
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let node = svg
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-key") == Some("node:A")
                            && n.attribute("data-mt-role") == Some("node")
                    })
                    .unwrap();
                assert!(
                    node.descendants()
                        .any(|n| n.has_tag_name(if look == "classic" {
                            "ellipse"
                        } else {
                            "path"
                        })),
                    "missing native ellipse silhouette"
                );
                let text: Vec<_> = source.encode_utf16().collect();
                let slice = |span: &Value| {
                    String::from_utf16(
                        &text[span["start"].as_u64().unwrap() as usize
                            ..span["end"].as_u64().unwrap() as usize],
                    )
                    .unwrap()
                };
                let piece = result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|p| p["domId"] == "node:A")
                    .unwrap();
                assert_eq!(slice(&piece["span"]), "A(-Café 😀-)");
                assert_eq!(slice(&piece["labelSpan"]), "Café 😀");
                let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "ellipse-native", &source).unwrap();
                assert_eq!(
                    strip_trace(result["svg"].as_str().unwrap()),
                    strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
    let source = std::fs::read_to_string(
        "vendor/merman/fixtures/flowchart/upstream_flow_text_ellipse_vertex_parser_only_spec.mmd",
    )
    .unwrap();
    mermaid_trace_rs::render("ellipse-pinned", &source)
        .expect("pinned ellipse fixture must render");
}

#[test]
fn flow_ac4_empty_and_collapsed_subgraph_proxies_keep_group_identity() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            for block in [
                "subgraph G[\"Empty 😀\"]\nend",
                "subgraph G[\"Empty 😀\"]\nb\nend",
                "subgraph G[\"Empty 😀\"]\nC --> D\nend\nG@{ view: collapsed }",
            ] {
                let source = format!(
                    "---\nconfig:\n  htmlLabels: {html}\n---\n{header}\nsubgraph A\na --> b\nend\n{block}\n"
                );
                let result = mermaid_trace_rs::render("group-proxy", &source).unwrap();
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let group = svg
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-key") == Some("flowchart:subgraph:G")
                            && n.attribute("data-mt-role") == Some("control")
                    })
                    .expect("leaf/collapsed subgraph must retain group selection");
                assert!(
                    !group
                        .descendants()
                        .any(|n| n.attribute("data-mt-key") == Some("node:G"))
                );
                assert!(
                    svg.descendants()
                        .any(|n| n.attribute("data-mt-role") == Some("control-label")
                            && n.ancestors().any(
                                |a| a.attribute("data-mt-key") == Some("flowchart:subgraph:G")
                            )),
                    "missing proxy title selection"
                );
                let piece = result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|p| p["domId"] == "flowchart:subgraph:G")
                    .unwrap();
                let text: Vec<_> = source.encode_utf16().collect();
                let slice = |span: &Value| {
                    String::from_utf16(
                        &text[span["start"].as_u64().unwrap() as usize
                            ..span["end"].as_u64().unwrap() as usize],
                    )
                    .unwrap()
                };
                assert_eq!(slice(&piece["span"]), block.split("\nG@{").next().unwrap());
                assert_eq!(slice(&piece["labelSpan"]), "Empty 😀");
                let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "group-proxy", &source).unwrap();
                assert_eq!(
                    strip_trace(result["svg"].as_str().unwrap()),
                    strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}
