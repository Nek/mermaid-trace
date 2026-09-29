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
    let edges: Vec<_> = pieces
        .iter()
        .filter(|p| p["kind"] == "edge" && p.get("relation").is_none())
        .collect();
    assert_eq!(
        nodes.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
        ["A[\"same\"]", "B[\"same\"]"]
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
    let references: Vec<_> = pieces
        .iter()
        .filter(|p| p["relation"] == "endpoint-reference")
        .collect();
    assert_eq!(
        references
            .iter()
            .map(|p| slice(&p["span"]))
            .collect::<Vec<_>>(),
        ["A", "B"]
    );
    assert!(references.iter().all(|p| p["domId"] == edges[1]["domId"]));
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
        1
    );
    assert_eq!(node.attribute("data-mt-start"), Some("29"));
}

#[test]
fn flow_ac4_parallel_self_loops_classify_only_overwritten_dagre_occurrences() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(serde_json::json!({
            "htmlLabels": false,
            "deterministicIds": true,
            "deterministicIDSeed": "mermaid-trace"
        })),
    ));
    for header in ["flowchart LR", "flowchart-elk LR"] {
        let source = format!("{header}\r\nA -->|first 😀| A\r\nA -->|second| A\r\n");
        let result = mermaid_trace_rs::render("parallel-self", &source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let native: Vec<Value> = serde_json::from_str(
            svg.descendants()
                .find_map(|node| node.attribute("data-mt-native"))
                .unwrap(),
        )
        .unwrap();
        let first: Vec<_> = native
            .iter()
            .filter(|piece| piece["domId"] == "edge:L_A_A_0")
            .collect();
        assert!(
            !first.is_empty(),
            "the earlier authored loop must survive: {header}"
        );
        assert!(first.iter().any(|piece| {
            let span = &piece["span"];
            &source
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize]
                == "-->|first 😀|"
        }));
        assert!(first.iter().any(|piece| {
            piece["relation"] == "endpoint-reference"
                && &source[piece["span"]["start"].as_u64().unwrap() as usize
                    ..piece["span"]["end"].as_u64().unwrap() as usize]
                    == "A"
        }));
        for piece in &first {
            if header == "flowchart LR" {
                assert_eq!(piece["kind"], "nonvisual");
                assert_eq!(piece["classification"], "overwritten-self-loop");
            } else {
                assert_eq!(piece["kind"], "edge");
                assert!(piece.get("classification").is_none());
            }
        }
        let mapped = result["mapping"]["pieces"].as_array().unwrap();
        assert_eq!(
            mapped
                .iter()
                .filter(|piece| piece["domId"] == "edge:L_A_A_0")
                .count(),
            usize::from(header == "flowchart-elk LR") * first.len(),
        );
        assert!(mapped.iter().any(|piece| piece["domId"] == "edge:L_A_A_2"));
        let baseline = mermaid_trace_rs::render_with(&plain, "parallel-self", &source).unwrap();
        assert_eq!(
            strip_trace(result["svg"].as_str().unwrap()),
            strip_trace(baseline["svg"].as_str().unwrap())
        );
    }
}

#[test]
fn flow_ac4_subgraph_ids_shadow_unrendered_node_occurrences() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(serde_json::json!({
            "htmlLabels": false,
            "deterministicIds": true,
            "deterministicIDSeed": "mermaid-trace"
        })),
    ));
    for (source, id, expected) in [
        (
            "flowchart LR\na --> b\nsubgraph A\nB\nend\nsubgraph B\nb\nend\n",
            "B",
            "B",
        ),
        (
            "flowchart-elk LR\ndecision --> Work\nsubgraph Work [Work]\nA\nend\nclassDef hot fill:red\nclass decision,Work hot\n",
            "Work",
            "class decision,Work hot",
        ),
    ] {
        let result = mermaid_trace_rs::render("shadowed-node", source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let native: Vec<Value> = serde_json::from_str(
            svg.descendants()
                .find_map(|node| node.attribute("data-mt-native"))
                .unwrap(),
        )
        .unwrap();
        let node_key = format!("node:{id}");
        let shadowed: Vec<_> = native
            .iter()
            .filter(|piece| piece["domId"] == node_key)
            .collect();
        assert_eq!(shadowed.len(), 1);
        let piece = shadowed[0];
        assert_eq!(piece["kind"], "nonvisual");
        assert_eq!(piece["classification"], "subgraph-id-shadow");
        let span = &piece["span"];
        assert_eq!(
            &source
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
            expected
        );
        let control_key = format!("flowchart:subgraph:{id}");
        assert!(
            result["mapping"]["pieces"]
                .as_array()
                .unwrap()
                .iter()
                .any(|piece| piece["domId"] == control_key)
        );
        assert!(
            !result["mapping"]["pieces"]
                .as_array()
                .unwrap()
                .iter()
                .any(|piece| piece["domId"] == node_key)
        );
        let baseline = mermaid_trace_rs::render_with(&plain, "shadowed-node", source).unwrap();
        assert_eq!(
            strip_trace(result["svg"].as_str().unwrap()),
            strip_trace(baseline["svg"].as_str().unwrap())
        );
    }
}

#[test]
fn flow_ac4_5_edge_occurrences_keep_exact_operators_across_renderers() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(serde_json::json!({
            "htmlLabels": false,
            "deterministicIds": true,
            "deterministicIDSeed": "mermaid-trace"
        })),
    ));
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                let source = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n  handDrawnSeed: 42\r\n---\r\n{header}\r\nA[\"Actor 😀\"] & B -->|Group 😀| C & D\r\nA --> B --> C\r\nA -->|first| B\r\nA -->|second| B\r\nA e1@--> B\r\nA e1@--> B\r\nA --> A\r\nA --> A\r\n"
                );
                let result = mermaid_trace_rs::render("edge-occurrences", &source).unwrap();
                let pieces = result["mapping"]["pieces"].as_array().unwrap();
                let edges: Vec<_> = pieces
                    .iter()
                    .filter(|piece| piece["kind"] == "edge" && piece.get("relation").is_none())
                    .collect();
                let expected_count = if header.contains("elk") { 12 } else { 11 };
                assert_eq!(edges.len(), expected_count, "{header} {look} {html}");
                let ids: std::collections::HashSet<_> = edges
                    .iter()
                    .map(|piece| piece["domId"].as_str().unwrap())
                    .collect();
                assert_eq!(ids.len(), expected_count, "distinct authored connectors");

                let utf16 = |byte: usize| source[..byte].encode_utf16().count();
                let mut expected = Vec::new();
                let group = source.find("-->|Group 😀|").unwrap();
                expected.push((group, group + "-->|Group 😀|".len(), 4));
                let chain = source.find("A --> B --> C").unwrap();
                for (offset, _) in source[chain..chain + "A --> B --> C".len()].match_indices("-->")
                {
                    expected.push((chain + offset, chain + offset + 3, 1));
                }
                for label in ["first", "second"] {
                    let operator = format!("-->|{label}|");
                    let start = source.find(&operator).unwrap();
                    expected.push((start, start + operator.len(), 1));
                }
                for (start, _) in source.match_indices("e1@-->") {
                    expected.push((start, start + "e1@-->".len(), 1));
                }
                for (index, (statement, _)) in source.match_indices("A --> A").enumerate() {
                    let start = statement + 2;
                    expected.push((
                        start,
                        start + 3,
                        usize::from(header.contains("elk") || index == 1),
                    ));
                }
                for (start, end, count) in expected {
                    let matching: Vec<_> = edges
                        .iter()
                        .filter(|piece| {
                            piece["span"]
                                == serde_json::json!({"start":utf16(start),"end":utf16(end)})
                        })
                        .collect();
                    assert_eq!(
                        matching.len(),
                        count,
                        "{header} {look} {html}: {}",
                        &source[start..end]
                    );
                    if start == group {
                        assert!(matching.iter().all(|piece| {
                            piece["labelSpan"]
                                == serde_json::json!({"start":utf16(group + 4),"end":utf16(end - 1)})
                        }));
                    }
                }
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let native: Vec<Value> = serde_json::from_str(
                    svg.descendants()
                        .find_map(|node| node.attribute("data-mt-native"))
                        .unwrap(),
                )
                .unwrap();
                assert_eq!(
                    native
                        .iter()
                        .filter(|piece| piece["classification"] == "overwritten-self-loop")
                        .count(),
                    if header.contains("elk") { 0 } else { 3 }
                );
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "edge-occurrences", &source).unwrap();
                assert_eq!(
                    strip_trace(result["svg"].as_str().unwrap()),
                    strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn flow_ac4_5_nonbreaking_html_labels_survive_safe_svg_with_exact_origins() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(serde_json::json!({
            "htmlLabels": false,
            "deterministicIds": true,
            "deterministicIDSeed": "mermaid-trace"
        })),
    ));
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for look in ["classic", "neo", "handDrawn"] {
            let source = format!(
                "---\r\nconfig:\r\n  htmlLabels: true\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n---\r\n{header}\r\n%% 😀\r\nA[\"&nbsp;\"] -->|&nbsp;| B[\"X&nbsp;\"]\r\nsubgraph G[\"Group\u{00A0}name\"]\r\nC --> D\r\nend\r\n"
            );
            let result = mermaid_trace_rs::render("nbsp-labels", &source).unwrap();
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            let utf16: Vec<_> = source.encode_utf16().collect();
            for (key, role, expected_source, expected_text) in [
                ("node:A", "node-label", "&nbsp;", "\u{00A0}"),
                ("node:B", "node-label", "X&nbsp;", "X\u{00A0}"),
                ("edge:L_A_B_0", "edge-label", "&nbsp;", "\u{00A0}"),
                (
                    "flowchart:subgraph:G",
                    "control-label",
                    "Group\u{00A0}name",
                    "Group\u{00A0}name",
                ),
            ] {
                let piece = pieces
                    .iter()
                    .find(|piece| piece["domId"] == key && piece.get("labelSpan").is_some())
                    .unwrap();
                let span = &piece["labelSpan"];
                let label_source = String::from_utf16(
                    &utf16[span["start"].as_u64().unwrap() as usize
                        ..span["end"].as_u64().unwrap() as usize],
                )
                .unwrap();
                assert_eq!(label_source, expected_source, "{header} {look} {key}");
                let label = svg
                    .descendants()
                    .find(|node| {
                        node.attribute("data-mt-key") == Some(key)
                            && node.attribute("data-mt-role") == Some(role)
                    })
                    .unwrap_or_else(|| panic!("missing {role} {key}: {header} {look}"));
                assert_eq!(
                    label
                        .descendants()
                        .filter(|node| node.is_text())
                        .filter_map(|node| node.text())
                        .collect::<String>(),
                    expected_text,
                    "{header} {look} {key}"
                );
            }
            let baseline = mermaid_trace_rs::render_with(&plain, "nbsp-labels", &source).unwrap();
            assert_eq!(
                strip_trace(result["svg"].as_str().unwrap()),
                strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
    let source = "flowchart LR\nsubgraph G[\"\u{00A0}\"]\nA --> B\nend\n";
    let result = mermaid_trace_rs::render("trimmed-title", source).unwrap();
    assert!(
        result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|piece| piece["domId"] == "flowchart:subgraph:G")
            .all(|piece| piece.get("labelSpan").is_none()),
        "Mermaid trims a direct all-NBSP subgraph title before rendering"
    );
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    assert!(!svg.descendants().any(|node| {
        node.attribute("data-mt-key") == Some("flowchart:subgraph:G")
            && node.attribute("data-mt-role") == Some("control-label")
    }));
}

#[test]
fn flow_ac4_5_edge_label_forms_keep_exact_payloads_and_only_painted_controls() {
    let forms = [
        ("A0 -->|plain| B0", "-->|plain|", Some("plain")),
        (
            "A1 -- split text --> B1",
            "-- split text -->",
            Some("split text"),
        ),
        (
            "A2 -- \"quoted text\" --> B2",
            "-- \"quoted text\" -->",
            Some("quoted text"),
        ),
        (
            "A3 -- \"`**marked**`\" --> B3",
            "-- \"`**marked**`\" -->",
            Some("**marked**"),
        ),
        (
            "A4 -->|\"`**pipe markdown**`\"| B4",
            "-->|\"`**pipe markdown**`\"|",
            Some("**pipe markdown**"),
        ),
        (
            "A5 -->|first<br/>second| B5",
            "-->|first<br/>second|",
            Some("first<br/>second"),
        ),
        ("A6 -->|A&amp;B| B6", "-->|A&amp;B|", Some("A&amp;B")),
        ("A7 -->|😀 A| B7", "-->|😀 A|", Some("😀 A")),
        ("A8 -->|$$x^2$$| B8", "-->|$$x^2$$|", Some("$$x^2$$")),
        ("A9 -->|   | B9", "-->|   |", None),
        ("A10 -->|<br/>| B10", "-->|<br/>|", Some("<br/>")),
        ("A11 -- No--> B11", "-- No-->", Some("N")),
        (
            "A12 -->|first\r\nsecond| B12",
            "-->|first\r\nsecond|",
            Some("first\r\nsecond"),
        ),
        ("A13 == thick ==> B13", "== thick ==>", Some("thick")),
        ("A14 -. dotted .-> B14", "-. dotted .->", Some("dotted")),
        (
            "A15 ==>|thick pipe| B15",
            "==>|thick pipe|",
            Some("thick pipe"),
        ),
        (
            "A16 -.->|dotted pipe| B16",
            "-.->|dotted pipe|",
            Some("dotted pipe"),
        ),
        ("A17 -- circle --o B17", "-- circle --o", Some("circle")),
        ("A18 -- cross --x B18", "-- cross --x", Some("cross")),
        ("A19 o-- round --> B19", "o-- round -->", Some("round")),
        (
            "A20 x-- crossed --> B20",
            "x-- crossed -->",
            Some("crossed"),
        ),
        (
            "A21 <-- backward --> B21",
            "<-- backward -->",
            Some("backward"),
        ),
    ];
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(serde_json::json!({
            "htmlLabels": false,
            "deterministicIds": true,
            "deterministicIDSeed": "mermaid-trace"
        })),
    ));
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for (chunk_index, chunk) in forms.chunks(11).enumerate() {
                    let source = format!(
                        "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n  handDrawnSeed: 42\r\n---\r\n{header}\r\n{}\r\n",
                        chunk
                            .iter()
                            .map(|(line, _, _)| *line)
                            .collect::<Vec<_>>()
                            .join("\r\n")
                    );
                    let result = mermaid_trace_rs::render("label-forms", &source).unwrap();
                    let pieces = result["mapping"]["pieces"].as_array().unwrap();
                    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                    let utf16 = |byte: usize| source[..byte].encode_utf16().count();
                    for (offset, (statement, operator, label)) in chunk.iter().enumerate() {
                        let index = chunk_index * 11 + offset;
                        let key = format!("edge:L_A{index}_B{index}_0");
                        let edge = pieces
                            .iter()
                            .find(|piece| {
                                piece["domId"] == key
                                    && piece["kind"] == "edge"
                                    && piece.get("relation").is_none()
                            })
                            .unwrap();
                        let start =
                            source.find(statement).unwrap() + statement.find(operator).unwrap();
                        assert_eq!(
                            edge["span"],
                            serde_json::json!({"start":utf16(start),"end":utf16(start + operator.len())}),
                            "{header} {look} {html} {index}"
                        );
                        match label {
                            Some(label) => {
                                let label_start = start + operator.find(label).unwrap();
                                assert_eq!(
                                    edge["labelSpan"],
                                    serde_json::json!({"start":utf16(label_start),"end":utf16(label_start + label.len())}),
                                    "{header} {look} {html} {index}"
                                );
                            }
                            None => assert!(edge.get("labelSpan").is_none()),
                        }
                        let visible = svg
                            .descendants()
                            .filter(|node| {
                                node.attribute("data-mt-key") == Some(key.as_str())
                                    && node.attribute("data-mt-role") == Some("edge-label")
                            })
                            .count();
                        assert_eq!(
                            visible,
                            usize::from(label.is_some() && !(html && index == 10)),
                            "{header} {look} {html} {index}"
                        );
                    }
                    let baseline =
                        mermaid_trace_rs::render_with(&plain, "label-forms", &source).unwrap();
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
fn flow_ac5_local_preview_renders_moderate_elk_graph_with_exact_label_mappings() {
    let source = format!(
        "---\r\nconfig:\r\n  look: classic\r\n  htmlLabels: false\r\n---\r\nflowchart-elk LR\r\n{}",
        (0..22)
            .map(|index| format!("A{index} -->|label{index}| B{index}\r\n"))
            .collect::<String>()
    );
    let result = mermaid_trace_rs::render("moderate-elk", &source).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    let utf16 = |byte: usize| source[..byte].encode_utf16().count();
    for index in 0..22 {
        let key = format!("edge:L_A{index}_B{index}_0");
        let edge = pieces
            .iter()
            .find(|piece| {
                piece["kind"] == "edge" && piece["domId"] == key && piece.get("relation").is_none()
            })
            .unwrap();
        let operator = format!("-->|label{index}|");
        let start = source
            .find(&format!("A{index} {operator} B{index}"))
            .unwrap()
            + format!("A{index} ").len();
        assert_eq!(
            edge["span"],
            serde_json::json!({"start":utf16(start),"end":utf16(start + operator.len())})
        );
        assert_eq!(
            edge["labelSpan"],
            serde_json::json!({"start":utf16(start + 4),"end":utf16(start + operator.len() - 1)})
        );
        assert_eq!(
            svg.descendants()
                .filter(|node| node.attribute("data-mt-key") == Some(key.as_str())
                    && node.attribute("data-mt-role") == Some("edge-label"))
                .count(),
            1
        );
    }
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(serde_json::json!({
            "htmlLabels": false,
            "deterministicIds": true,
            "deterministicIDSeed": "mermaid-trace"
        })),
    ));
    let baseline = mermaid_trace_rs::render_with(&plain, "moderate-elk", &source).unwrap();
    assert_eq!(
        strip_trace(result["svg"].as_str().unwrap()),
        strip_trace(baseline["svg"].as_str().unwrap())
    );
    assert_eq!(
        mermaid_trace_rs::render("too-long", &"A".repeat(50_001)).unwrap_err(),
        "Invalid Mermaid source length"
    );
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
                assert_eq!(
                    pieces.len(),
                    3,
                    "all real declarations remain; the later endpoint belongs to its edge"
                );
                let endpoint = result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|p| p["relation"] == "endpoint-reference" && p["endpoint"] == "from")
                    .unwrap();
                let start = source[..source.rfind("A --> B").unwrap()]
                    .encode_utf16()
                    .count();
                assert_eq!(
                    endpoint["span"],
                    serde_json::json!({"start":start,"end":start+1})
                );
                assert_eq!(endpoint["from"], "A");
                assert_eq!(endpoint["to"], "B");
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
                    3
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
        let native: Vec<Value> = serde_json::from_str(
            svg.descendants()
                .find_map(|node| node.attribute("data-mt-native"))
                .unwrap(),
        )
        .unwrap();
        let mapped: std::collections::HashSet<_> = result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|piece| piece["domId"].as_str())
            .collect();
        for piece in native.iter().filter(|piece| {
            ["node", "edge", "control"].contains(&piece["kind"].as_str().unwrap_or(""))
        }) {
            assert!(
                mapped.contains(piece["domId"].as_str().unwrap()),
                "unclassified lost visual: {} {}",
                file.display(),
                piece
            );
        }
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
                node.is_text()
                    && node.text().is_some_and(|text| {
                        !text
                            .trim_matches(|ch: char| {
                                matches!(ch, ' ' | '\t' | '\n' | '\r' | '\u{000C}')
                            })
                            .is_empty()
                    })
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

#[test]
fn flow_ac4_layout_connectors_keep_exact_authored_spans_and_static_output() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                let source = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n%% 😀\r\nA ghost@~~~ B\r\nB labeled@~~~|Same 😀| C\r\nC painted@~~~ D\r\nlinkStyle 2 stroke:#123,stroke-width:3px\r\n"
                );
                let result = mermaid_trace_rs::render("layout-links", &source).unwrap();
                let utf16: Vec<_> = source.encode_utf16().collect();
                let slice = |span: &Value| {
                    String::from_utf16(
                        &utf16[span["start"].as_u64().unwrap() as usize
                            ..span["end"].as_u64().unwrap() as usize],
                    )
                    .unwrap()
                };
                let pieces = result["mapping"]["pieces"].as_array().unwrap();
                for (key, expected) in [
                    ("edge:ghost", "ghost@~~~"),
                    ("edge:labeled", "labeled@~~~|Same 😀|"),
                    ("edge:painted", "painted@~~~"),
                ] {
                    let piece = pieces
                        .iter()
                        .find(|p| p["domId"] == key && p.get("relation").is_none())
                        .unwrap();
                    assert_eq!(slice(&piece["span"]), expected);
                    if key == "edge:labeled" {
                        assert_eq!(slice(&piece["labelSpan"]), "Same 😀");
                    }
                }
                let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "layout-links", &source).unwrap();
                assert_eq!(
                    strip_trace(result["svg"].as_str().unwrap()),
                    strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn flow_ac4_5_operator_inventory_has_exact_ranges_and_static_parity() {
    let inventory: Value = serde_json::from_str(include_str!(
        "../../mermaid-trace-ts/test/fixtures/flowchart/operators.json"
    ))
    .unwrap();
    let operators = inventory["operators"].as_array().unwrap();
    assert_eq!(operators.len(), 195);
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))
    ));
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for batch in operators.chunks(16) {
                    let mut source = format!(
                        "---\r\nconfig:\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n%% 😀\r\n"
                    );
                    for (i, operator) in batch.iter().enumerate() {
                        source.push_str(&format!(
                            "A{i} e{i}@{} B{i}\r\n",
                            operator.as_str().unwrap()
                        ));
                    }
                    let mapped = mermaid_trace_rs::render("operators", &source).unwrap();
                    let baseline =
                        mermaid_trace_rs::render_with(&plain, "operators", &source).unwrap();
                    assert_eq!(
                        strip_trace(mapped["svg"].as_str().unwrap()),
                        strip_trace(baseline["svg"].as_str().unwrap())
                    );
                    let pieces = mapped["mapping"]["pieces"].as_array().unwrap();
                    for (i, operator) in batch.iter().enumerate() {
                        let expected = format!("e{i}@{}", operator.as_str().unwrap());
                        let start = source[..source.find(&expected).unwrap()]
                            .encode_utf16()
                            .count();
                        let piece = pieces
                            .iter()
                            .find(|piece| {
                                piece["kind"] == "edge"
                                    && piece["domId"] == format!("edge:e{i}")
                                    && piece.get("relation").is_none()
                            })
                            .unwrap();
                        assert_eq!(
                            piece["span"],
                            serde_json::json!({"start":start,"end":start + expected.encode_utf16().count()}),
                            "{expected}/{header}/{look}/{html}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn own_flow_endpoint_references_bind_the_actual_connections() {
    for header in ["graph", "flowchart", "flowchart-elk"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for nested in [false, true] {
                    for (statement, reference_counts, edge_count) in [
                        ("A --> B", vec![1, 1], 1),
                        ("A & B --> C & D", vec![2, 2, 2, 2], 4),
                        ("A --> B --> C", vec![1, 2, 1], 2),
                        ("A --> A", vec![1, 1], 1),
                        ("A & A --> B", vec![1, 1, 2], 2),
                        ("A --> B & B", vec![2, 1, 1], 2),
                        ("A e1@-->|go| B", vec![1, 1], 1),
                        ("A --> B\r\nA --> B", vec![1, 1, 1, 1], 2),
                        ("H --> B", vec![1, 1], 1),
                        ("E --> B", vec![1, 1], 1),
                    ] {
                        let declarations = "A[Alpha 😀]\r\nB[Beta]\r\nC[Gamma]\r\nD[Delta]\r\n";
                        let body = format!(
                            "{declarations}style E fill:red\r\nsubgraph H\r\nI[Inside]\r\nend\r\n{statement}\r\n"
                        );
                        let body = if nested {
                            format!("subgraph G\r\n{body}end\r\n")
                        } else {
                            body
                        };
                        let source = format!(
                            "---\r\nconfig:\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n  htmlLabels: {html}\r\n---\r\n{header} LR\r\n{body}"
                        );
                        let result = mermaid_trace_rs::render("flow-owner", &source).unwrap();
                        let pieces = result["mapping"]["pieces"].as_array().unwrap();
                        let primary: Vec<_> = pieces
                            .iter()
                            .filter(|p| p["kind"] == "edge" && p.get("relation").is_none())
                            .collect();
                        assert_eq!(primary.len(), edge_count, "{source}");
                        let byte = source.find(statement).unwrap();
                        let tokens: Vec<_> = statement
                            .char_indices()
                            .filter(|(_, c)| ['A', 'B', 'C', 'D', 'E', 'H'].contains(c))
                            .collect();
                        assert_eq!(tokens.len(), reference_counts.len());
                        for ((offset, id), count) in tokens.into_iter().zip(reference_counts) {
                            let start = source[..byte + offset].encode_utf16().count();
                            let span = serde_json::json!({"start":start,"end":start+1});
                            assert!(
                                !pieces
                                    .iter()
                                    .any(|p| p["kind"] == "node" && p["span"] == span),
                                "a reference must not select its destination: {source}"
                            );
                            let owners: Vec<_> = pieces
                                .iter()
                                .filter(|p| {
                                    p["kind"] == "edge"
                                        && p["relation"] == "endpoint-reference"
                                        && p["span"] == span
                                })
                                .collect();
                            assert_eq!(
                                owners.len(),
                                count,
                                "every actual owning connection must bind the token: {source}"
                            );
                            for owner in owners {
                                let edge = primary
                                    .iter()
                                    .find(|p| p["domId"] == owner["domId"])
                                    .unwrap();
                                assert_eq!(owner["from"], edge["from"]);
                                assert_eq!(owner["to"], edge["to"]);
                                assert_eq!(owner["target"], id.to_string());
                                assert!(owner.get("labelSpan").is_none());
                            }
                        }
                        let svg =
                            roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                        for edge in primary {
                            let visual = svg
                                .descendants()
                                .find(|n| {
                                    n.attribute("data-mt-key") == edge["domId"].as_str()
                                        && n.attribute("data-mt-role") == Some("edge")
                                })
                                .unwrap();
                            assert_eq!(
                                visual
                                    .attribute("data-mt-start")
                                    .unwrap()
                                    .parse::<u64>()
                                    .unwrap(),
                                edge["span"]["start"].as_u64().unwrap(),
                                "references must not replace the primary connector click range"
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn own_flow_real_node_origins_survive_reference_consolidation() {
    for (body, expected) in [
        ("A --> B\r\nA --> B\r\n", vec!["A", "B"]),
        ("A --> B --> C\r\n", vec!["A", "B", "C"]),
        ("style A fill:red\r\nA --> B\r\n", vec!["B"]),
        ("A & A --> B\r\n", vec!["A", "B"]),
        (
            "A[Alpha 😀] --> B[Beta]\r\nA:::hot --> B\r\n",
            vec!["A[Alpha 😀]", "B[Beta]", "A:::hot"],
        ),
        (
            "A[Alpha 😀] --> B[Beta]\r\nA[Again] --> B\r\n",
            vec!["A[Alpha 😀]", "B[Beta]", "A[Again]"],
        ),
        (
            "A[Alpha 😀] --> B[Beta]\r\nA\r\nB\r\n",
            vec!["A[Alpha 😀]", "B[Beta]", "A", "B"],
        ),
        ("subgraph G\r\nA\r\nend\r\nG --> B\r\n", vec!["A", "B"]),
    ] {
        let source = format!("flowchart LR\r\n%% 😀\r\n{body}");
        let result = mermaid_trace_rs::render("flow-real-origins", &source).unwrap();
        let pieces = result["mapping"]["pieces"].as_array().unwrap();
        let text: Vec<_> = source.encode_utf16().collect();
        let slice = |span: &Value| {
            String::from_utf16(
                &text[span["start"].as_u64().unwrap() as usize
                    ..span["end"].as_u64().unwrap() as usize],
            )
            .unwrap()
        };
        let nodes: Vec<_> = pieces
            .iter()
            .filter(|p| p["kind"] == "node" && p.get("relation").is_none())
            .collect();
        assert_eq!(
            nodes.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
            expected,
            "{source}"
        );
        if body.starts_with("style") {
            assert!(
                pieces
                    .iter()
                    .any(|p| p["relation"] == "endpoint-reference" && p["target"] == "A"),
                "style-created endpoints belong to the connection"
            );
            let style = pieces
                .iter()
                .find(|p| p["relation"] == "style" && p["semanticId"] == "A")
                .unwrap();
            assert_eq!(style["declaration"], true);
            assert_eq!(slice(&style["labelSpan"]), "A");
        }
        if body.contains("G --> B") {
            let reference = pieces
                .iter()
                .find(|p| p["relation"] == "endpoint-reference" && p["target"] == "G")
                .unwrap();
            assert_eq!(slice(&reference["span"]), "G");
            assert_eq!(reference["from"], "G");
            assert!(pieces.iter().any(|p| p["domId"] == "flowchart:subgraph:G"));
        }
    }
}

#[test]
fn flow_ac5_min_node_width_sizes_labels_before_padding_without_changing_ownership() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(serde_json::json!({
            "htmlLabels": false, "deterministicIds": true, "deterministicIDSeed": "mermaid-trace"
        })),
    ));
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            let mut widths = Vec::new();
            for minimum in [0, 240, 360] {
                let source = format!(
                    "---\r\nconfig:\r\n  look: classic\r\n  htmlLabels: {html}\r\n  flowchart:\r\n    minNodeWidth: {minimum}\r\n    wrappingWidth: 1000\r\n    padding: 15\r\n---\r\n{header}\r\nA[\"Short 😀\"] --> B[\"\"]\r\nC[\"This label is deliberately much longer than any configured minimum label width in this example\"]\r\n"
                );
                let result = mermaid_trace_rs::render("minimum-width", &source).unwrap();
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "minimum-width", &source).unwrap();
                assert_eq!(
                    strip_trace(result["svg"].as_str().unwrap()),
                    strip_trace(baseline["svg"].as_str().unwrap())
                );
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let width = |key| {
                    svg.descendants()
                        .find(|node| {
                            node.attribute("data-mt-key") == Some(key)
                                && node.attribute("data-mt-role") == Some("node")
                        })
                        .unwrap()
                        .descendants()
                        .find(|node| {
                            node.has_tag_name("rect")
                                && node.attribute("class").is_some_and(|class| {
                                    class.split_whitespace().any(|c| c == "basic")
                                })
                        })
                        .unwrap()
                        .attribute("width")
                        .unwrap()
                        .parse::<f64>()
                        .unwrap()
                };
                widths.push((width("node:A"), width("node:B"), width("node:C")));
                let piece = result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|p| p["domId"] == "node:A" && p["kind"] == "node")
                    .unwrap();
                let utf16: Vec<_> = source.encode_utf16().collect();
                let slice = |span: &Value| {
                    String::from_utf16(
                        &utf16[span["start"].as_u64().unwrap() as usize
                            ..span["end"].as_u64().unwrap() as usize],
                    )
                    .unwrap()
                };
                assert_eq!(slice(&piece["span"]), "A[\"Short 😀\"]");
                assert_eq!(slice(&piece["labelSpan"]), "Short 😀");
            }
            assert!(
                widths[0].0 < 240.0,
                "baseline must be narrower: {header}/{html}"
            );
            assert_eq!(
                widths[1].0, 300.0,
                "minimum label width plus padding: {header}/{html}"
            );
            assert_eq!(widths[2].0, 420.0, "larger minimum: {header}/{html}");
            assert_eq!(widths[0].1, widths[1].1, "empty label must stay empty");
            assert_eq!(widths[1].1, widths[2].1);
            assert_eq!(widths[0].2, widths[1].2, "long label must not shrink");
            assert_eq!(widths[1].2, widths[2].2);
        }
    }
}

#[test]
fn flow_ac5_min_node_width_leaves_explicit_assets_and_non_node_labels_unchanged() {
    for header in ["flowchart LR", "flowchart-elk LR"] {
        for html in [false, true] {
            for body in [
                "A@{ icon: \"fa:star\", form: square, label: \"Icon\", w: 60, h: 60 }",
                "A@{ img: \"https://example.com/image.png\", label: \"Image\", w: 60, h: 60 }",
                "subgraph G[Group title]\nA[\"\"] -->|Edge label| B[\"\"]\nend",
            ] {
                let source = format!(
                    "---\nconfig:\n  htmlLabels: {html}\n  flowchart:\n    minNodeWidth: 0\n---\n{header}\n{body}\n"
                );
                let baseline = mermaid_trace_rs::render("minimum-exceptions", &source).unwrap();
                for minimum in [-1, 500] {
                    let changed =
                        source.replace("minNodeWidth: 0", &format!("minNodeWidth: {minimum}"));
                    let result = mermaid_trace_rs::render("minimum-exceptions", &changed).unwrap();
                    assert_eq!(
                        strip_trace(result["svg"].as_str().unwrap()),
                        strip_trace(baseline["svg"].as_str().unwrap()),
                        "{header}/{html}/{body}"
                    );
                }
                let absent = mermaid_trace_rs::render(
                    "minimum-exceptions",
                    &source.replace("    minNodeWidth: 0\n", ""),
                )
                .unwrap();
                assert_eq!(
                    strip_trace(absent["svg"].as_str().unwrap()),
                    strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn flow_ac5_bump_x_curve_and_edge_override_keep_distinct_geometry_and_exact_ownership() {
    let mut paths = Vec::new();
    for (curve, override_curve) in [
        ("basis", false),
        ("bumpX", false),
        ("bumpY", false),
        ("basis", true),
    ] {
        let source = format!(
            "---\nconfig:\n  flowchart:\n    curve: {curve}\n---\nflowchart LR\nA[Start] e@-->|next| B[Finish]\nA --> C[Branch]\nC --> B\n{}",
            if override_curve {
                "e@{ curve: bumpX }\n"
            } else {
                ""
            }
        );
        let result = mermaid_trace_rs::render("bump-curve", &source).unwrap();
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let edge = svg
            .descendants()
            .find(|node| {
                node.attribute("data-mt-key") == Some("edge:e")
                    && node.attribute("data-mt-role") == Some("edge")
            })
            .unwrap();
        paths.push(edge.attribute("d").unwrap().to_string());
        let piece = result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["domId"] == "edge:e" && p["kind"] == "edge" && p.get("relation").is_none())
            .unwrap();
        let span = &piece["span"];
        assert_eq!(
            &source
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
            "e@-->|next|"
        );
        let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
        let baseline = mermaid_trace_rs::render_with(&plain, "bump-curve", &source).unwrap();
        assert_eq!(
            strip_trace(result["svg"].as_str().unwrap()),
            strip_trace(baseline["svg"].as_str().unwrap())
        );
    }
    assert_ne!(paths[1], paths[0], "bumpX must not fall back to basis");
    assert_ne!(
        paths[1], paths[2],
        "bumpX and bumpY have different tangents"
    );
    assert_eq!(
        paths[1], paths[3],
        "edge override takes precedence over the diagram default"
    );
}

#[test]
fn flow_ac5_scoped_appearance_matches_effective_root_rendering() {
    use serde_json::json;
    let mut site = json!({"traceSource":true,"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"});
    let native = merman::Renderer::new().with_engine(
        merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(site.clone())),
    );
    site["traceSource"] = json!(false);
    let plain = merman::Renderer::new().with_engine(
        merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(site)),
    );
    for (config, expected) in [
        (
            json!({"flowchart":{"theme":"dark"}}),
            json!({"theme":"dark"}),
        ),
        (
            json!({"flowchart":{"look":"handDrawn"},"handDrawnSeed":42}),
            json!({"look":"handDrawn","handDrawnSeed":42}),
        ),
        (
            json!({"flowchart":{"layout":"elk"}}),
            json!({"layout":"elk"}),
        ),
        (
            json!({"theme":"forest","look":"classic","layout":"dagre","flowchart":{"theme":"dark","look":"neo","layout":"elk"}}),
            json!({"theme":"dark","look":"neo","layout":"elk"}),
        ),
        (
            json!({"theme":"forest","look":"classic","flowchart":{"theme":"constructor","look":"invalid"}}),
            json!({"theme":"forest","look":"classic"}),
        ),
        (
            json!({"flowchart":{"theme":"dark"},"themeVariables":{"primaryColor":"#123456"}}),
            json!({"theme":"dark","themeVariables":{"primaryColor":"#123456"}}),
        ),
    ].into_iter().chain([
        "default", "base", "dark", "forest", "neutral", "neo", "neo-dark",
        "redux", "redux-dark", "redux-color", "redux-dark-color", "null",
    ].into_iter().map(|theme| (json!({"flowchart":{"theme":theme}}), json!({"theme":theme})))) {
        for header in ["flowchart LR", "graph LR", "flowchart-elk LR"] {
            for directive in [false, true] {
                let source = |cfg: &Value| {
                    format!(
                        "{}\n{header}\nA[\"Short 😀\"] e@-->|next| B[Finish]\nA --> C[Branch]\nC --> B\n",
                        if directive {
                            format!("%%{{init: {cfg}}}%%")
                        } else {
                            format!("---\nconfig: {cfg}\n---")
                        }
                    )
                };
                let actual =
                    mermaid_trace_rs::render_with(&native, "scoped-config", &source(&config))
                        .unwrap();
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "scoped-config", &source(&expected))
                        .unwrap();
                assert_eq!(
                    strip_trace(actual["svg"].as_str().unwrap()),
                    strip_trace(baseline["svg"].as_str().unwrap()),
                    "{header}, directive={directive}: {config}"
                );
                let input = source(&config);
                let utf16: Vec<_> = input.encode_utf16().collect();
                let node = actual["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|p| p["domId"] == "node:A" && p["kind"] == "node")
                    .unwrap();
                let span = &node["labelSpan"];
                assert_eq!(
                    String::from_utf16(
                        &utf16[span["start"].as_u64().unwrap() as usize
                            ..span["end"].as_u64().unwrap() as usize]
                    )
                    .unwrap(),
                    "Short 😀"
                );
            }
        }
    }
}
