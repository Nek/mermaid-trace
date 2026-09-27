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
        ["B", "Café 😀", "Round", "Done"]
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

#[test]
fn flow_ac4_styles_retain_native_relationships_created_nodes_and_label_origins() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            let source = format!(
                "---\r\nconfig:\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n%% 😀\r\nstyle Q fill:#fff\r\nstyle Q stroke:#333\r\nQ --> A[\"Actor 😀\"]\r\nstyle A fill:#eee\r\nstyle R fill:#ddd\r\nR[\"Replacement 😀\"]\r\nsubgraph G[Group]\r\nC --> D\r\nend\r\nstyle G fill:#bbb\r\nstyle H fill:#aaa\r\nsubgraph H[Later group]\r\nE --> F\r\nend\r\nA e1@--> Q\r\nstyle e1 fill:#f00\r\n"
            );
            let result = mermaid_trace_rs::render("styled-native", &source).unwrap();
            let text: Vec<_> = source.encode_utf16().collect();
            let slice = |span: &Value| {
                String::from_utf16(
                    &text[span["start"].as_u64().unwrap() as usize
                        ..span["end"].as_u64().unwrap() as usize],
                )
                .unwrap()
            };
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            for (key, expected, label) in [
                ("node:Q", "style Q fill:#fff", "Q"),
                ("node:A", "A[\"Actor 😀\"]", "Actor 😀"),
                ("node:R", "R[\"Replacement 😀\"]", "Replacement 😀"),
            ] {
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let node = svg
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-key") == Some(key)
                            && n.attribute("data-mt-role") == Some("node")
                    })
                    .expect("style-created node must remain mapped");
                let span = serde_json::json!({"start":node.attribute("data-mt-start").unwrap().parse::<usize>().unwrap(),"end":node.attribute("data-mt-end").unwrap().parse::<usize>().unwrap()});
                assert_eq!(slice(&span), expected);
                let label_node = svg
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-role") == Some("node-label")
                            && n.ancestors()
                                .any(|a| a.attribute("data-mt-key") == Some(key))
                    })
                    .unwrap();
                let label_span = serde_json::json!({"start":label_node.attribute("data-mt-start").unwrap().parse::<usize>().unwrap(),"end":label_node.attribute("data-mt-end").unwrap().parse::<usize>().unwrap()});
                assert_eq!(slice(&label_span), label);
            }
            for (key, statements) in [
                ("node:Q", vec!["style Q fill:#fff", "style Q stroke:#333"]),
                ("node:A", vec!["style A fill:#eee"]),
                ("node:R", vec!["style R fill:#ddd"]),
                ("flowchart:subgraph:G", vec!["style G fill:#bbb"]),
                ("flowchart:subgraph:H", vec!["style H fill:#aaa"]),
            ] {
                let styles: Vec<_> = pieces
                    .iter()
                    .filter(|p| p["domId"] == key && p["relation"] == "style")
                    .map(|p| slice(&p["span"]))
                    .collect();
                assert_eq!(styles, statements);
            }
            let native = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let metadata: Vec<Value> = serde_json::from_str(
                native
                    .descendants()
                    .find_map(|n| n.attribute("data-mt-native"))
                    .unwrap(),
            )
            .unwrap();
            assert!(metadata.iter().any(|p| p["kind"] == "nonvisual"
                && p["relation"] == "style"
                && &source[p["span"]["start"].as_u64().unwrap() as usize
                    ..p["span"]["end"].as_u64().unwrap() as usize]
                    == "style e1 fill:#f00"));
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline = mermaid_trace_rs::render_with(&plain, "styled-native", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
}

#[test]
fn flow_ac5_full_pinned_inventory_maps_semantic_wrappers_and_preserves_svg() {
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let mut files: Vec<_> = std::fs::read_dir("vendor/merman/fixtures/flowchart")
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "mmd"))
        .collect();
    files.sort();
    assert_eq!(files.len(), 1158, "refresh the pinned inventory explicitly");
    for file in files {
        let source = std::fs::read_to_string(&file).unwrap();
        let result = mermaid_trace_rs::render_with(&renderer, "flow-inventory", &source)
            .unwrap_or_else(|error| panic!("{}: {error}", file.display()));
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        for node in svg.descendants().filter(|node| node.has_tag_name("g")) {
            if node
                .attribute("class")
                .unwrap_or("")
                .split_whitespace()
                .any(|class| {
                    ["node", "rough-node", "cluster", "image-shape", "icon-shape"].contains(&class)
                })
            {
                assert!(
                    matches!(node.attribute("data-mt-role"), Some("node" | "control")),
                    "unmapped semantic wrapper: {} {:?}",
                    file.display(),
                    node.attribute("id")
                );
            }
        }
        for label in svg
            .descendants()
            .filter(|node| node.attribute("data-mt-label") == Some("true"))
        {
            let visible = label.descendants().any(|node| {
                node.is_text() && node.text().is_some_and(|text| !text.trim().is_empty())
                    || [
                        "path",
                        "line",
                        "rect",
                        "circle",
                        "ellipse",
                        "polygon",
                        "polyline",
                        "image",
                        "foreignObject",
                    ]
                    .iter()
                    .any(|tag| node.has_tag_name(*tag))
            });
            if visible {
                assert!(
                    label
                        .attribute("data-mt-role")
                        .is_some_and(|role| role.ends_with("-label")),
                    "unmapped visible native label: {} {:?}",
                    file.display(),
                    label.attribute("data-mt-key")
                );
            }
        }
        for connector in svg.descendants().filter(|node| {
            node.attribute("class")
                .unwrap_or("")
                .split_whitespace()
                .any(|class| class == "flowchart-link")
        }) {
            assert_eq!(
                connector.attribute("data-mt-role"),
                Some("edge"),
                "unmapped connector: {} {:?}",
                file.display(),
                connector.attribute("id")
            );
        }
        let baseline = mermaid_trace_rs::render_with(&plain, "flow-inventory", &source).unwrap();
        assert_eq!(
            strip_trace(result["svg"].as_str().unwrap()),
            strip_trace(baseline["svg"].as_str().unwrap()),
            "annotation changed {} rendering",
            file.display()
        );
    }
}

#[test]
fn flow_ac4_default_id_labels_keep_exact_first_creation_origins() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            let source = format!(
                "---\r\nconfig:\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n%% 😀\r\nA --> B\r\nB --> C\r\nstyle Q fill:#fff\r\nQ --> A\r\nZ\r\nstyle Z fill:#eee\r\nZ --> Q\r\nE\r\nE[\"\"]\r\n"
            );
            let result = mermaid_trace_rs::render("default-id", &source).unwrap();
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            for (id, origin) in [
                ("A", "A --> B"),
                ("B", "B\r\nB --> C"),
                ("C", "C\r\nstyle Q"),
                ("Q", "Q fill:#fff"),
                ("Z", "Z\r\nstyle Z"),
            ] {
                let start = source[..source.find(origin).unwrap()]
                    .encode_utf16()
                    .count();
                let expected = serde_json::json!({"start":start,"end":start+id.len()});
                let key = format!("node:{id}");
                let label = svg
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-role") == Some("node-label")
                            && n.ancestors()
                                .any(|a| a.attribute("data-mt-key") == Some(&key))
                    })
                    .unwrap_or_else(|| panic!("missing default label {id}, html={html}, {header}"));
                assert_eq!(
                    label
                        .attribute("data-mt-start")
                        .unwrap()
                        .parse::<usize>()
                        .unwrap(),
                    start,
                    "label {id}"
                );
                assert_eq!(
                    label
                        .attribute("data-mt-end")
                        .unwrap()
                        .parse::<usize>()
                        .unwrap(),
                    start + id.len()
                );
                let effective: Vec<_> = pieces
                    .iter()
                    .filter(|p| p["domId"] == key && p["effective"] == true)
                    .collect();
                assert_eq!(
                    effective.len(),
                    1,
                    "one authoritative default origin for {id}"
                );
                assert_eq!(effective[0]["labelSpan"], expected);
                assert_eq!(
                    pieces
                        .iter()
                        .filter(|p| p["domId"] == key && p.get("labelSpan").is_some())
                        .count(),
                    1,
                    "references must not masquerade as displayed labels"
                );
            }
            assert!(
                !svg.descendants()
                    .any(|n| n.attribute("data-mt-role") == Some("node-label")
                        && n.ancestors()
                            .any(|a| a.attribute("data-mt-key") == Some("node:E"))),
                "explicit empty label must not acquire a fabricated default label"
            );
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline = mermaid_trace_rs::render_with(&plain, "default-id", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
}

#[test]
fn flow_ac4_shape_data_labels_and_properties_keep_native_yaml_origins() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            let source = format!(
                "---\r\nconfig:\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n%% 😀\r\nA@{{ shape: rounded, label: \"Payload 😀\" }} --> B\r\nA@{{label: \"Final 😀\"}}\r\nM@{{label: \"First\r\n   second 😀\"}}\r\nP@{{label: \"Earlier 😀\"}}\r\nP[\"Last 😀\"]\r\nB e1@--> A\r\ne1@{{animate: true, curve: linear}}\r\nsubgraph G[Group]\r\nC --> D\r\nend\r\nG@{{view: collapsed}}\r\n"
            );
            let result = mermaid_trace_rs::render("shape-data", &source).unwrap();
            let utf16: Vec<_> = source.encode_utf16().collect();
            let slice = |span: &Value| {
                String::from_utf16(
                    &utf16[span["start"].as_u64().unwrap() as usize
                        ..span["end"].as_u64().unwrap() as usize],
                )
                .unwrap()
            };
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            for (id, label, definition) in [
                ("A", "Final 😀", "A@{label: \"Final 😀\"}"),
                ("P", "Last 😀", "P[\"Last 😀\"]"),
                (
                    "M",
                    "First\r\n   second 😀",
                    "M@{label: \"First\r\n   second 😀\"}",
                ),
            ] {
                let key = format!("node:{id}");
                let node = svg
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-role") == Some("node")
                            && n.attribute("data-mt-key") == Some(&key)
                    })
                    .unwrap();
                let label_node = svg
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-role") == Some("node-label")
                            && n.ancestors()
                                .any(|a| a.attribute("data-mt-key") == Some(&key))
                    })
                    .unwrap();
                let span = |n: roxmltree::Node<'_, '_>| serde_json::json!({"start":n.attribute("data-mt-start").unwrap().parse::<usize>().unwrap(),"end":n.attribute("data-mt-end").unwrap().parse::<usize>().unwrap()});
                assert_eq!(
                    slice(&span(node)),
                    definition,
                    "complete shape-data statement"
                );
                assert_eq!(
                    slice(&span(label_node)),
                    label,
                    "exact YAML payload before lexer normalization"
                );
                if id != "M" {
                    let displayed: String = label_node
                        .descendants()
                        .filter(|node| node.is_text())
                        .filter_map(|node| node.text())
                        .collect();
                    assert!(
                        displayed.contains(label),
                        "the renderer must display the effective label: {id} {displayed}"
                    );
                }
            }
            for (key, property, expected) in [
                ("node:A", "shape", "rounded"),
                ("node:A", "label", "Final 😀"),
                ("edge:e1", "curve", "linear"),
                ("flowchart:subgraph:G", "view", "collapsed"),
            ] {
                assert!(
                    pieces.iter().any(|p| p["domId"] == key
                        && p["relation"] == "shape-data-property"
                        && p["property"] == property
                        && slice(&p["span"]) == expected),
                    "missing exact property {key} {property}"
                );
            }
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline = mermaid_trace_rs::render_with(&plain, "shape-data", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
}

#[test]
fn flow_ac4_shape_data_yaml_scalar_forms_and_empty_values_keep_exact_selections() {
    for (body, expected) in [
        (r#"label: "Escaped \u0061 😀""#, r#"Escaped \u0061 😀"#),
        ("'label': 'Can''t 😀'", "Can''t 😀"),
        ("label: 42", "42"),
        ("label: true", "true"),
        ("label: |\n  First\n  second 😀", "First\n  second 😀"),
        ("label: >\n  First\n  second 😀", "First\n  second 😀"),
        ("label: &caption \"Alias 😀\"", "Alias 😀"),
        (
            "caption: &caption \"Anchor 😀\", label: *caption",
            "*caption",
        ),
    ] {
        let source = format!("flowchart LR\nA@{{{body}}}\nA --> B\n");
        let result = mermaid_trace_rs::render("yaml-labels", &source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let label = svg
            .descendants()
            .find(|n| {
                n.attribute("data-mt-role") == Some("node-label")
                    && n.ancestors()
                        .any(|a| a.attribute("data-mt-key") == Some("node:A"))
            })
            .unwrap_or_else(|| panic!("missing label: {body}"));
        let start = label
            .attribute("data-mt-start")
            .unwrap()
            .parse::<usize>()
            .unwrap();
        let end = label
            .attribute("data-mt-end")
            .unwrap()
            .parse::<usize>()
            .unwrap();
        assert_eq!(
            String::from_utf16(&source.encode_utf16().collect::<Vec<_>>()[start..end]).unwrap(),
            expected,
            "{body}"
        );
    }
    for body in ["label: \"\"", "label: ''"] {
        let source = format!("flowchart LR\nA@{{{body}}}\nA --> B\n");
        let result = mermaid_trace_rs::render("yaml-empty", &source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        assert!(!svg.descendants().any(|n| {
            n.attribute("data-mt-role") == Some("node-label")
                && n.ancestors()
                    .any(|a| a.attribute("data-mt-key") == Some("node:A"))
        }));
    }
}

#[test]
fn flow_ac4_class_and_link_directives_retain_exact_native_relationships() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            let source = format!(
                "---\r\nconfig:\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n%% 😀\r\nclass Missing hot\r\nclick Missing callback \"missing\"\r\nclassDef hot fill:#eee\r\nclassDef default stroke:#333\r\nclassDef unused fill:#f00\r\nA[\"Actor 😀\"]:::hot --> B[\"Book\"]\r\nA e1@--> B\r\nsubgraph G[Group]\r\nC --> D\r\nend\r\nG --> B\r\nclass A,G,e1 hot\r\nclick A href \"https://example.com\" \"go\"\r\nlinkStyle 0 stroke:#f00\r\nlinkStyle default stroke-width:2px\r\nB --> C\r\n"
            );
            let result = mermaid_trace_rs::render("native-directives", &source).unwrap();
            let text: Vec<_> = source.encode_utf16().collect();
            let slice = |span: &Value| {
                String::from_utf16(
                    &text[span["start"].as_u64().unwrap() as usize
                        ..span["end"].as_u64().unwrap() as usize],
                )
                .unwrap()
            };
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            for (key, relation, expected) in [
                ("node:A", "inline-class", ":::hot"),
                ("node:A", "class", "class A,G,e1 hot"),
                ("flowchart:subgraph:G", "class", "class A,G,e1 hot"),
                ("edge:e1", "class", "class A,G,e1 hot"),
                ("node:A", "classDef", "classDef hot fill:#eee"),
                ("flowchart:subgraph:G", "classDef", "classDef hot fill:#eee"),
                ("edge:e1", "classDef", "classDef hot fill:#eee"),
                ("node:A", "classDef", "classDef default stroke:#333"),
                ("node:D", "classDef", "classDef default stroke:#333"),
                (
                    "node:A",
                    "click",
                    "click A href \"https://example.com\" \"go\"",
                ),
            ] {
                assert!(
                    pieces.iter().any(|p| p["domId"] == key
                        && p["relation"] == relation
                        && slice(&p["span"]) == expected),
                    "missing {key} {relation}: {expected}"
                );
            }
            assert_eq!(
                pieces
                    .iter()
                    .filter(|p| p["domId"] == "flowchart:subgraph:G"
                        && p["relation"] == "classDef"
                        && slice(&p["span"]) == "classDef hot fill:#eee")
                    .count(),
                1,
                "one authored class-definition relationship per visual target"
            );
            assert!(
                !pieces.iter().any(|p| p["domId"] == "flowchart:subgraph:G"
                    && p["relation"] == "classDef"
                    && slice(&p["span"]) == "classDef default stroke:#333"),
                "expanded groups do not inherit the native node default class"
            );
            let identified_edge = pieces
                .iter()
                .find(|p| p["domId"] == "edge:e1" && p.get("relation").is_none())
                .unwrap();
            assert_eq!(
                slice(&identified_edge["span"]),
                "e1@-->",
                "authored edge ID belongs to its connector selection"
            );
            let first_edge = pieces
                .iter()
                .find(|p| p["kind"] == "edge" && p["from"] == "A" && p["to"] == "B")
                .unwrap();
            assert!(pieces.iter().any(|p| p["domId"] == first_edge["domId"]
                && p["relation"] == "linkStyle"
                && slice(&p["span"]) == "linkStyle 0 stroke:#f00"));
            for edge in pieces
                .iter()
                .filter(|p| p["kind"] == "edge" && p.get("relation").is_none())
            {
                assert!(pieces.iter().any(|p| p["domId"] == edge["domId"]
                    && p["relation"] == "linkStyle"
                    && slice(&p["span"]) == "linkStyle default stroke-width:2px"));
            }
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let node = svg
                .descendants()
                .find(|n| {
                    n.attribute("data-mt-key") == Some("node:A")
                        && n.attribute("data-mt-role") == Some("node")
                })
                .unwrap();
            let node_span = serde_json::json!({"start":node.attribute("data-mt-start").unwrap().parse::<usize>().unwrap(),"end":node.attribute("data-mt-end").unwrap().parse::<usize>().unwrap()});
            assert_eq!(slice(&node_span), "A[\"Actor 😀\"]:::hot");
            let native: Vec<Value> = serde_json::from_str(
                svg.descendants()
                    .find_map(|n| n.attribute("data-mt-native"))
                    .unwrap(),
            )
            .unwrap();
            for expected in [
                "class Missing hot",
                "click Missing callback \"missing\"",
                "classDef unused fill:#f00",
            ] {
                assert!(
                    native.iter().any(|p| p["kind"] == "nonvisual"
                        && &source[p["span"]["start"].as_u64().unwrap() as usize
                            ..p["span"]["end"].as_u64().unwrap() as usize]
                            == expected),
                    "missing nonvisual classification: {expected}"
                );
            }
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline =
                mermaid_trace_rs::render_with(&plain, "native-directives", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
}

#[test]
fn flow_ac4_repeated_directives_preserve_distinct_occurrences_and_native_inheritance() {
    let source = "flowchart LR\r\n%% 😀\r\nclass A hot\r\nclassDef hot fill:#eee\r\nclassDef hot stroke:#123\r\nclassDef node stroke-width:3px\r\nA:::hot --> B\r\nA e1@--> B\r\nclass A,e1 hot\r\nclass A,e1 hot\r\nlinkStyle 0,1 stroke:#234\r\nclick A callback \"go 😀\"\r\n";
    let result = mermaid_trace_rs::render("repeated-directives", source).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let text: Vec<_> = source.encode_utf16().collect();
    let slice = |p: &Value| {
        String::from_utf16(
            &text[p["span"]["start"].as_u64().unwrap() as usize
                ..p["span"]["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let classes: Vec<_> = pieces
        .iter()
        .filter(|p| p["domId"] == "node:A" && p["relation"] == "class")
        .collect();
    assert_eq!(
        classes.len(),
        2,
        "an assignment before node creation is nonvisual; later repeats remain distinct"
    );
    assert_ne!(classes[0]["span"], classes[1]["span"]);
    for key in ["node:A", "edge:e1"] {
        for authored in ["classDef hot fill:#eee", "classDef hot stroke:#123"] {
            assert!(
                pieces.iter().any(|p| p["domId"] == key
                    && p["relation"] == "classDef"
                    && slice(p) == authored)
            );
        }
    }
    for key in ["node:A", "node:B"] {
        assert!(pieces.iter().any(|p| p["domId"] == key
            && p["relation"] == "classDef"
            && slice(p) == "classDef node stroke-width:3px"));
    }
    assert_eq!(
        pieces
            .iter()
            .filter(|p| p["relation"] == "linkStyle" && slice(p) == "linkStyle 0,1 stroke:#234")
            .count(),
        2
    );
    assert!(pieces.iter().any(|p| p["domId"] == "node:A"
        && p["relation"] == "click"
        && slice(p) == "click A callback \"go 😀\""));
}

#[test]
fn flow_ac4_scoped_direction_occurrences_keep_native_groups_and_exact_ranges() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            let source = format!(
                "---\r\nconfig:\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n%% 😀\r\ndirection BT\r\nsubgraph G[Outer]\r\ndirection TB\r\nsubgraph \"Inner 😀\"\r\ndirection RL\r\nA --> B\r\nend\r\ndirection LR\r\nend\r\nsubgraph E[Empty]\r\ndirection TD\r\nend\r\nE --> G\r\nsubgraph Z[Collapsed]\r\ndirection BT\r\nC --> D\r\nend\r\nZ@{{view: collapsed}}\r\nZ --> E\r\n"
            );
            let result = mermaid_trace_rs::render("directions", &source).unwrap();
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            let text: Vec<_> = source.encode_utf16().collect();
            let slice = |span: &Value| {
                String::from_utf16(
                    &text[span["start"].as_u64().unwrap() as usize
                        ..span["end"].as_u64().unwrap() as usize],
                )
                .unwrap()
            };
            for (key, authored) in [
                ("flowchart:subgraph:G", "direction TB"),
                ("flowchart:subgraph:G", "direction LR"),
                ("flowchart:subgraph:subGraph0", "direction RL"),
                ("flowchart:subgraph:E", "direction TD"),
                ("flowchart:subgraph:Z", "direction BT"),
            ] {
                assert!(
                    pieces.iter().any(|p| p["domId"] == key
                        && p["relation"] == "direction"
                        && slice(&p["span"]) == authored),
                    "missing {key}: {authored}"
                );
            }
            assert!(!pieces.iter().any(|p| {
                p["relation"] == "direction"
                    && p["span"]["start"].as_u64().unwrap()
                        < source[..source.find("subgraph G").unwrap()]
                            .encode_utf16()
                            .count() as u64
            }));
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let native: Vec<Value> = serde_json::from_str(
                svg.descendants()
                    .find_map(|n| n.attribute("data-mt-native"))
                    .unwrap(),
            )
            .unwrap();
            let byte_slice = |span: &Value| {
                &source[span["start"].as_u64().unwrap() as usize
                    ..span["end"].as_u64().unwrap() as usize]
            };
            for (classification, authored) in [
                ("diagram-header", header),
                ("ignored-root-direction", "direction BT"),
            ] {
                assert!(native.iter().any(|p| p["kind"] == "nonvisual"
                    && p["classification"] == classification
                    && byte_slice(&p["span"]) == authored));
            }
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline = mermaid_trace_rs::render_with(&plain, "directions", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
}

#[test]
fn flow_ac4_accessibility_retains_exact_occurrences_and_effective_payloads() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            let source = format!(
                "---\r\nconfig:\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n%% 😀\r\n  accTitle : First 😀  \r\naccTitle: Last 😀\r\naccDescr: Earlier\r\naccDescr {{\r\n  First 😀\r\n  second\r\n}}\r\nA[Actor] --> B\r\n"
            );
            let result = mermaid_trace_rs::render("accessible", &source).unwrap();
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let native: Vec<Value> = serde_json::from_str(
                svg.descendants()
                    .find_map(|n| n.attribute("data-mt-native"))
                    .unwrap(),
            )
            .unwrap();
            let slice = |span: &Value| {
                &source[span["start"].as_u64().unwrap() as usize
                    ..span["end"].as_u64().unwrap() as usize]
            };
            for (statement, payload, effective) in [
                ("accTitle : First 😀", "First 😀", false),
                ("accTitle: Last 😀", "Last 😀", true),
                ("accDescr: Earlier", "Earlier", false),
                (
                    "accDescr {\r\n  First 😀\r\n  second\r\n}",
                    "First 😀\r\n  second",
                    true,
                ),
            ] {
                let piece = native
                    .iter()
                    .find(|p| {
                        p["classification"] == "accessibility" && slice(&p["span"]) == statement
                    })
                    .unwrap_or_else(|| panic!("missing {statement}"));
                assert_eq!(piece["kind"], "nonvisual");
                assert_eq!(piece["effective"], effective);
                assert_eq!(slice(&piece["labelSpan"]), payload);
            }
            assert_eq!(
                native
                    .iter()
                    .filter(|p| p["classification"] == "accessibility")
                    .count(),
                4
            );
            assert_eq!(
                svg.descendants()
                    .find(|n| n.has_tag_name("title"))
                    .and_then(|n| n.text()),
                Some("Last 😀")
            );
            assert_eq!(
                svg.descendants()
                    .find(|n| n.has_tag_name("desc"))
                    .and_then(|n| n.text()),
                Some("First 😀\nsecond")
            );
            assert!(
                !svg.descendants()
                    .filter(|n| n.has_tag_name("title") || n.has_tag_name("desc"))
                    .any(|n| n.attribute("data-mt-role").is_some())
            );
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline = mermaid_trace_rs::render_with(&plain, "accessible", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
    for source in [
        "flowchart LR\naccTitle: First\naccTitle: \naccDescr: \nA --> B\n",
        "flowchart LR\naccDescr: Earlier\nA --> B\naccDescr {Unfinished 😀",
    ] {
        let result = mermaid_trace_rs::render("accessible-empty", source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let native: Vec<Value> = serde_json::from_str(
            svg.descendants()
                .find_map(|n| n.attribute("data-mt-native"))
                .unwrap(),
        )
        .unwrap();
        if source.contains("Unfinished") {
            assert!(
                native
                    .iter()
                    .any(|p| p["classification"] == "incomplete-accessibility"
                        && p["effective"] == false)
            );
            assert!(native.iter().any(|p| p["field"] == "accDescr"
                && p["classification"] == "accessibility"
                && p["effective"] == true));
            assert_eq!(
                svg.descendants()
                    .find(|n| n.has_tag_name("desc"))
                    .and_then(|n| n.text()),
                Some("Earlier")
            );
        } else {
            let empty: Vec<_> = native
                .iter()
                .filter(|p| p["classification"] == "accessibility" && p["effective"] == true)
                .collect();
            assert_eq!(empty.len(), 2);
            assert!(empty.iter().all(|p| p.get("labelSpan").is_none()));
        }
    }
}

#[test]
fn flow_ac4_configuration_constructs_keep_original_evidence_and_visual_parity() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            let frontmatter = "---\r\ntitle: Config 😀\r\nconfig:\r\n  flowchart:\r\n    nodeSpacing: 60\r\n  unknown:\r\n    nested: 'Value 😀'\r\n---\r\n";
            let first = "%%{init: { flowchart: { nodeSpacing: 70 }, theme: 'default' }}%%";
            let second = format!(
                "%%{{initialize: {{ htmlLabels: {html}, flowchart: {{ nodeSpacing: 80, \"html\\u004cabels\": {html} }}, values: [{{ nested: 'Value 😀' }}] }}}}%%"
            );
            let source = format!(
                "\u{feff}{frontmatter}{first}\r\n{second}\r\n{header}\r\nA[Actor] --> B\r\n"
            );
            let result = mermaid_trace_rs::render("configuration", &source).unwrap();
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let native: Vec<Value> = serde_json::from_str(
                svg.descendants()
                    .find_map(|n| n.attribute("data-mt-native"))
                    .unwrap(),
            )
            .unwrap();
            let slice = |span: &Value| {
                &source[span["start"].as_u64().unwrap() as usize
                    ..span["end"].as_u64().unwrap() as usize]
            };
            assert!(native.iter().any(|p| p["kind"] == "nonvisual"
                && p["classification"] == "frontmatter"
                && slice(&p["span"]) == frontmatter));
            for (order, authored, keyword) in
                [(0, first, "init"), (1, second.as_str(), "initialize")]
            {
                assert!(
                    native.iter().any(|p| p["kind"] == "nonvisual"
                        && p["classification"] == "source-directive"
                        && p["keyword"] == keyword
                        && p["complete"] == true
                        && p["order"] == order
                        && slice(&p["span"]) == authored),
                    "missing full {keyword}"
                );
            }
            let value = native
                .iter()
                .find(|p| {
                    p["classification"] == "configuration-key"
                        && p["path"] == serde_json::json!(["config", "unknown", "nested"])
                })
                .unwrap();
            assert_eq!(slice(&value["span"]), "nested: 'Value 😀'");
            assert_eq!(slice(&value["labelSpan"]), "Value 😀");
            assert!(
                native
                    .iter()
                    .any(|p| p["classification"] == "configuration-key"
                        && p["path"] == serde_json::json!(["flowchart", "nodeSpacing"])
                        && slice(&p["span"]) == "nodeSpacing: 70"
                        && slice(&p["labelSpan"]) == "70")
            );
            let escaped = native
                .iter()
                .find(|p| {
                    p["classification"] == "configuration-key"
                        && p["path"] == serde_json::json!(["flowchart", "htmlLabels"])
                })
                .expect("escaped JSON5 key provenance");
            assert_eq!(
                slice(&escaped["span"]),
                format!("html\\u004cabels\": {html}")
            );
            assert_eq!(slice(&escaped["labelSpan"]), html.to_string());
            let array = native
                .iter()
                .find(|p| {
                    p["classification"] == "configuration-key"
                        && p["path"] == serde_json::json!(["values", 0, "nested"])
                })
                .expect("array object key provenance");
            assert_eq!(slice(&array["span"]), "nested: 'Value 😀'");
            assert_eq!(slice(&array["labelSpan"]), "Value 😀");
            assert!(
                result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p["domId"] == "flowchart:title")
            );
            assert!(
                result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|p| p["classification"].is_null())
            );
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline = mermaid_trace_rs::render_with(&plain, "configuration", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
}

#[test]
fn flow_ac4_directive_metadata_preserves_native_ignored_and_incomplete_behavior() {
    for (source, keyword, complete) in [
        ("%%{wrap}%%\nflowchart LR\nA --> B\n", "wrap", true),
        (
            "flowchart LR\nA --> B\n%%{init: { theme: 'default'",
            "init",
            false,
        ),
        (
            "%%{init: { broken: [ }}%%\nflowchart LR\nA --> B\n",
            "init",
            true,
        ),
    ] {
        let result = mermaid_trace_rs::render("directive-status", source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let native: Vec<Value> = serde_json::from_str(
            svg.descendants()
                .find_map(|n| n.attribute("data-mt-native"))
                .unwrap(),
        )
        .unwrap();
        let directives: Vec<_> = native
            .iter()
            .filter(|p| p["classification"] == "source-directive")
            .collect();
        assert_eq!(directives.len(), 1);
        assert_eq!(directives[0]["keyword"], keyword);
        assert_eq!(directives[0]["complete"], complete);
        let span = &directives[0]["span"];
        let expected_start = source.find("%%{").unwrap();
        let expected_end = if complete {
            source.find("}%%").unwrap() + 3
        } else {
            source.len()
        };
        assert_eq!(
            &source
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
            &source[expected_start..expected_end]
        );
        assert!(
            result["mapping"]["pieces"]
                .as_array()
                .unwrap()
                .iter()
                .all(|p| p["kind"] != "nonvisual")
        );
        let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
        let baseline = mermaid_trace_rs::render_with(&plain, "directive-status", source).unwrap();
        assert_eq!(
            strip_trace(result["svg"].as_str().unwrap()),
            strip_trace(baseline["svg"].as_str().unwrap())
        );
    }
}

#[test]
fn flow_ac4_json5_tokens_keep_escapes_continuations_containers_and_typed_array_paths() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        let directive = "%%{init: { unknown: {\r\n  'esc\\u0061ped' /* key */: 'a\\u0062 😀',\r\n  continued: 'line\\\r\nend',\r\n  empty: '', number: -0xF, nil: null, bool: true,\r\n  repeated: 'first', repeated: 'last',\r\n  values: [[{ nested: 'array', '0': 'array key' }]],\r\n  object: { '0': { nested: 'object' } },\r\n  container: [1, /* item */ 'two',],\r\n} }}%%";
        let source = format!("\u{feff}{directive}\r\n{header}\r\nA[Actor] --> B\r\n");
        let result = mermaid_trace_rs::render("json5-tokens", &source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let native: Vec<Value> = serde_json::from_str(
            svg.descendants()
                .find_map(|n| n.attribute("data-mt-native"))
                .unwrap(),
        )
        .unwrap();
        let slice = |span: &Value| {
            &source
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize]
        };
        for (path, expected_span, expected_selection) in [
            (
                serde_json::json!(["unknown", "escaped"]),
                "esc\\u0061ped' /* key */: 'a\\u0062 😀'",
                Some("a\\u0062 😀"),
            ),
            (
                serde_json::json!(["unknown", "continued"]),
                "continued: 'line\\\r\nend'",
                Some("line\\\r\nend"),
            ),
            (serde_json::json!(["unknown", "empty"]), "empty: ''", None),
            (
                serde_json::json!(["unknown", "number"]),
                "number: -0xF",
                Some("-0xF"),
            ),
            (
                serde_json::json!(["unknown", "nil"]),
                "nil: null",
                Some("null"),
            ),
            (
                serde_json::json!(["unknown", "bool"]),
                "bool: true",
                Some("true"),
            ),
            (
                serde_json::json!(["unknown", "values", 0, 0, "nested"]),
                "nested: 'array'",
                Some("array"),
            ),
            (
                serde_json::json!(["unknown", "values", 0, 0, "0"]),
                "0': 'array key'",
                Some("array key"),
            ),
            (
                serde_json::json!(["unknown", "object", "0", "nested"]),
                "nested: 'object'",
                Some("object"),
            ),
            (
                serde_json::json!(["unknown", "container"]),
                "container: [1, /* item */ 'two',]",
                None,
            ),
        ] {
            let piece = native
                .iter()
                .find(|p| p["classification"] == "configuration-key" && p["path"] == path)
                .unwrap_or_else(|| panic!("missing {path}"));
            assert_eq!(slice(&piece["span"]), expected_span);
            match expected_selection {
                Some(expected) => assert_eq!(slice(&piece["labelSpan"]), expected),
                None => assert!(piece["labelSpan"].is_null()),
            }
        }
        let repeated: Vec<_> = native
            .iter()
            .filter(|p| p["path"] == serde_json::json!(["unknown", "repeated"]))
            .collect();
        assert_eq!(
            repeated
                .iter()
                .map(|p| slice(&p["labelSpan"]))
                .collect::<Vec<_>>(),
            ["first", "last"]
        );
        assert!(repeated[0]["order"].as_u64().unwrap() < repeated[1]["order"].as_u64().unwrap());
        let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
        let baseline = mermaid_trace_rs::render_with(&plain, "json5-tokens", &source).unwrap();
        assert_eq!(
            strip_trace(result["svg"].as_str().unwrap()),
            strip_trace(baseline["svg"].as_str().unwrap())
        );
    }
}

#[test]
fn flow_ac4_icon_and_image_labels_have_exact_native_bindings() {
    let image = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiBmaWxsPSJyZWQiLz48L3N2Zz4=";
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            for properties in [
                "icon: 'missing:icon'".to_string(),
                "icon: 'missing:icon', form: circle".to_string(),
                "icon: 'missing:icon', form: rounded".to_string(),
                "icon: 'missing:icon', form: square".to_string(),
                format!("img: '{image}', w: 48, h: 48, constraint: on"),
            ] {
                for pos in ["t", "b"] {
                    let statement = format!("A@{{ {properties}, pos: {pos}, label: 'Asset 😀' }}");
                    let source = format!(
                        "---\r\nconfig:\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n{statement}\r\nA --> B\r\n"
                    );
                    let result = mermaid_trace_rs::render("asset-label", &source).unwrap();
                    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                    let label = svg.descendants().find(|n| n.attribute("data-mt-key") == Some("node:A") && n.attribute("data-mt-role") == Some("node-label")).unwrap_or_else(|| panic!("missing asset label: {properties}, {header}, html={html}, pos={pos}"));
                    assert!(
                        !svg.descendants().any(|n| n.has_tag_name("text")
                            && n.descendants()
                                .any(|child| child.is_text() && child.text() == Some("?"))
                            && n.has_attribute("data-mt-role")),
                        "icon placeholder text is generated, not the authored label"
                    );
                    let utf16: Vec<_> = source.encode_utf16().collect();
                    let start = label
                        .attribute("data-mt-start")
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    let end = label
                        .attribute("data-mt-end")
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    assert_eq!(String::from_utf16(&utf16[start..end]).unwrap(), "Asset 😀");
                    for empty in ["", " "] {
                        let empty_source = source.replace("Asset 😀", empty);
                        let empty_result =
                            mermaid_trace_rs::render("asset-empty", &empty_source).unwrap();
                        let empty_svg =
                            roxmltree::Document::parse(empty_result["svg"].as_str().unwrap())
                                .unwrap();
                        assert!(
                            empty_svg
                                .descendants()
                                .any(|n| n.attribute("data-mt-key") == Some("node:A")
                                    && n.attribute("data-mt-role") == Some("node"))
                        );
                        assert!(
                            !empty_svg.descendants().any(|n| n.attribute("data-mt-role")
                                == Some("node-label")
                                && n.ancestors().any(
                                    |parent| parent.attribute("data-mt-key") == Some("node:A")
                                )),
                            "empty asset labels and placeholder glyphs must not receive source label controls"
                        );
                    }
                    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                    let baseline =
                        mermaid_trace_rs::render_with(&plain, "asset-label", &source).unwrap();
                    assert_eq!(
                        strip_trace(result["svg"].as_str().unwrap()),
                        strip_trace(baseline["svg"].as_str().unwrap())
                    );
                }
            }
        }
    }
}

#[test]
fn flow_ac4_svg_labels_are_native_groups_and_console_glyphs_are_generated() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for look in ["classic", "handDrawn"] {
            let source = format!(
                "---\r\nconfig:\r\n  htmlLabels: false\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n---\r\n{header}\r\nA@{{ shape: console, label: 'Console 😀' }}\r\nB[\"First 😀<br/>second\"]\r\nC[\"`First **bold** 😀\r\nsecond`\"]\r\nA --> B --> C\r\nE[\"\"]\r\n"
            );
            let result = mermaid_trace_rs::render("svg-label-groups", &source).unwrap();
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let glyph = svg
                .descendants()
                .find(|n| n.attribute("class") == Some("console-glyph"))
                .unwrap();
            assert_eq!(glyph.attribute("data-mt-generated"), Some("glyph"));
            assert!(
                !glyph.has_attribute("data-mt-role"),
                "decorative console glyph must not become the source label"
            );
            let utf16: Vec<_> = source.encode_utf16().collect();
            for (id, expected) in [
                ("A", "Console 😀"),
                ("B", "First 😀<br/>second"),
                ("C", "First **bold** 😀\r\nsecond"),
            ] {
                let key = format!("node:{id}");
                let labels: Vec<_> = svg
                    .descendants()
                    .filter(|n| {
                        n.attribute("data-mt-key") == Some(key.as_str())
                            && n.attribute("data-mt-role") == Some("node-label")
                    })
                    .collect();
                assert_eq!(
                    labels.len(),
                    1,
                    "one native label group for {id}, {header}, {look}"
                );
                assert!(labels[0].has_tag_name("g"));
                let start = labels[0]
                    .attribute("data-mt-start")
                    .unwrap()
                    .parse::<usize>()
                    .unwrap();
                let end = labels[0]
                    .attribute("data-mt-end")
                    .unwrap()
                    .parse::<usize>()
                    .unwrap();
                assert_eq!(String::from_utf16(&utf16[start..end]).unwrap(), expected);
                assert!(
                    !labels[0]
                        .descendants()
                        .any(|n| n.has_tag_name("text") && n.has_attribute("data-mt-role")),
                    "line fragments must not create duplicate label controls"
                );
            }
            assert!(
                !svg.descendants()
                    .any(|n| n.attribute("data-mt-key") == Some("node:E")
                        && n.attribute("data-mt-role") == Some("node-label"))
            );
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline =
                mermaid_trace_rs::render_with(&plain, "svg-label-groups", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
}

#[test]
fn flow_ac5_state_shape_has_finite_native_geometry_and_exact_label_ranges() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                let statement = "A@{ shape: state, label: 'State 😀' }";
                let source = format!(
                    "---\r\nconfig:\r\n  htmlLabels: {html}\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n  themeVariables:\r\n    radius: 17\r\n---\r\n{header}\r\n{statement}\r\nA --> B\r\n"
                );
                let result = mermaid_trace_rs::render("state-shape", &source).unwrap();
                let raw = result["svg"].as_str().unwrap();
                assert!(!raw.contains("NaN") && !raw.contains("Infinity"));
                let svg = roxmltree::Document::parse(raw).unwrap();
                let node = svg
                    .descendants()
                    .find(|n| {
                        n.attribute("data-mt-key") == Some("node:A")
                            && n.attribute("data-mt-role") == Some("node")
                    })
                    .unwrap();
                if look != "handDrawn" {
                    let body = node.children().find(|n| n.has_tag_name("rect")).unwrap();
                    assert_eq!(
                        body.attribute("rx"),
                        Some(if look == "neo" { "3" } else { "5" })
                    );
                    assert_eq!(body.attribute("ry"), body.attribute("rx"));
                    for dimension in ["width", "height"] {
                        let value = body.attribute(dimension).unwrap().parse::<f64>().unwrap();
                        assert!(value.is_finite() && value > 0.0);
                    }
                } else {
                    assert!(node.descendants().any(|n| n.has_tag_name("path")
                        && n.attribute("d").is_some_and(|d| !d.is_empty())));
                }
                let utf16: Vec<_> = source.encode_utf16().collect();
                for (role, expected) in [("node", statement), ("node-label", "State 😀")] {
                    let visual = svg
                        .descendants()
                        .find(|n| {
                            n.attribute("data-mt-key") == Some("node:A")
                                && n.attribute("data-mt-role") == Some(role)
                        })
                        .unwrap();
                    let start = visual
                        .attribute("data-mt-start")
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    let end = visual
                        .attribute("data-mt-end")
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    assert_eq!(String::from_utf16(&utf16[start..end]).unwrap(), expected);
                }
                let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "state-shape", &source).unwrap();
                assert_eq!(
                    strip_trace(raw),
                    strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn flow_ac5_every_pinned_public_shape_keeps_native_node_and_label_bindings() {
    let shapes: Vec<_> = merman::diagrams::flowchart::flowchart_public_shape_names().collect();
    assert_eq!(
        shapes.len(),
        146,
        "review the pinned public-shape inventory when updating Merman"
    );
    let inventory: Value = serde_json::from_str(
        &std::fs::read_to_string("../mermaid-trace-ts/test/fixtures/flowchart/public-shapes.json")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        inventory["shapes"],
        serde_json::json!(shapes),
        "refresh the shared shape inventory explicitly"
    );
    let no_label: Vec<_> = inventory["withoutLabels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|shape| shape.as_str().unwrap())
        .collect();
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for shape in &shapes {
                    let statement = format!("A@{{shape: {shape}, label: 'Same 😀'}}");
                    let source = format!(
                        "---\r\nconfig:\r\n  htmlLabels: {html}\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n---\r\n{header}\r\n%% 😀\r\n{statement} --> B[\"Same 😀\"]\r\nA --> B\r\n"
                    );
                    let result = mermaid_trace_rs::render_with(&renderer, "public-shapes", &source)
                        .unwrap_or_else(|error| panic!("{shape}/{header}/{look}/{html}: {error}"));
                    let raw = result["svg"].as_str().unwrap();
                    assert!(
                        !raw.contains("NaN") && !raw.contains("Infinity"),
                        "{shape}/{header}/{look}/{html}"
                    );
                    let svg = roxmltree::Document::parse(raw).unwrap();
                    let utf16: Vec<_> = source.encode_utf16().collect();
                    let node = svg
                        .descendants()
                        .find(|n| {
                            n.attribute("data-mt-key") == Some("node:A")
                                && n.attribute("data-mt-role") == Some("node")
                        })
                        .unwrap();
                    let start = node
                        .attribute("data-mt-start")
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    let end = node
                        .attribute("data-mt-end")
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    assert_eq!(
                        String::from_utf16(&utf16[start..end]).unwrap(),
                        statement,
                        "{shape}/{header}/{look}/{html}"
                    );
                    let labels: Vec<_> = svg
                        .descendants()
                        .filter(|n| {
                            n.attribute("data-mt-key") == Some("node:A")
                                && n.attribute("data-mt-role") == Some("node-label")
                        })
                        .collect();
                    assert_eq!(
                        labels.len(),
                        usize::from(!no_label.contains(shape)),
                        "label controls for {shape}/{header}/{look}/{html}"
                    );
                    if let Some(label) = labels.first() {
                        let start = label
                            .attribute("data-mt-start")
                            .unwrap()
                            .parse::<usize>()
                            .unwrap();
                        let end = label
                            .attribute("data-mt-end")
                            .unwrap()
                            .parse::<usize>()
                            .unwrap();
                        let byte_start =
                            source.find(&statement).unwrap() + statement.find("Same 😀").unwrap();
                        assert_eq!(
                            start,
                            source[..byte_start].encode_utf16().count(),
                            "repeated text cannot substitute another label origin"
                        );
                        assert_eq!(String::from_utf16(&utf16[start..end]).unwrap(), "Same 😀");
                    }
                    let baseline =
                        mermaid_trace_rs::render_with(&plain, "public-shapes", &source).unwrap();
                    assert_eq!(
                        strip_trace(raw),
                        strip_trace(baseline["svg"].as_str().unwrap()),
                        "{shape}/{header}/{look}/{html}"
                    );
                }
            }
        }
    }
}
