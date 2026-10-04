mod support;
use serde_json::Value;

fn selected(source: &str, span: &Value) -> String {
    let text: Vec<_> = source.encode_utf16().collect();
    String::from_utf16(
        &text[span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
    )
    .unwrap()
}

#[test]
fn state_ac4_each_description_row_has_its_own_original_source() {
    for header in ["stateDiagram", "stateDiagram-v2"] {
        let source = format!(
            "{header}\n[*] --> A\nstate \"Title 😀\" as A: compact 😀\nA : repeated 😀\nA : repeated 😀\nA --> A : again\n"
        );
        let rendered = mermaid_trace_rs::render("state-rows", &source)
            .expect("valid multiple state descriptions");
        let svg = roxmltree::Document::parse(rendered["svg"].as_str().unwrap()).unwrap();
        let pieces = rendered["mapping"]["pieces"].as_array().unwrap();
        let labels: Vec<_> = svg
            .descendants()
            .filter(|n| n.attribute("data-mt-role") == Some("node-label"))
            .map(|n| {
                assert!(
                    n.has_tag_name("text"),
                    "independent source labels must remain separate text objects for glyph conversion"
                );
                let refs = n.attribute("data-mt-refs").unwrap();
                let piece = pieces.iter().find(|p| p["id"] == refs).unwrap();
                selected(&source, piece.get("labelSpan").unwrap_or(&piece["span"]))
            })
            .collect();
        assert_eq!(
            labels,
            ["Title 😀", "compact 😀", "repeated 😀", "repeated 😀"]
        );
        let repeated: Vec<_> = pieces
            .iter()
            .filter(|p| {
                p["domId"].as_str().unwrap().starts_with("state:label:A:")
                    && selected(&source, &p["span"]) == "repeated 😀"
            })
            .collect();
        assert_eq!(repeated.len(), 2);
        assert_ne!(repeated[0]["span"], repeated[1]["span"]);
    }
}

#[test]
fn state_ac5_pinned_upstream_corpus_has_no_unmapped_semantic_shapes() {
    let fixtures =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor/merman/fixtures/state");
    let mut paths: Vec<_> = std::fs::read_dir(fixtures)
        .unwrap()
        .map(|p| p.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "mmd"))
        .collect();
    paths.sort();
    assert_eq!(
        paths.len(),
        286,
        "refresh the pinned state coverage inventory when upstream fixtures change"
    );
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let mut failures = Vec::new();
    for path in paths {
        let source = std::fs::read_to_string(&path).unwrap();
        let result = mermaid_trace_rs::render("state-corpus", &source);
        match result {
            Err(error) => failures.push(format!(
                "{}: {error}",
                path.file_name().unwrap().to_string_lossy()
            )),
            Ok(result) => {
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "state-corpus", &source).unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(baseline["svg"].as_str().unwrap()),
                    "{}",
                    path.display()
                );
                let document = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                for node in document.descendants().filter(|n| {
                    n.has_tag_name("g")
                        && n.attribute("class").is_some_and(|c| {
                            c.split_whitespace()
                                .any(|c| c == "node" || c == "cluster" || c == "statediagram-state")
                        })
                }) {
                    // Generated note layout wrappers and regions without any authored statement remain decoration.
                    let generated = node.attribute("data-mt-generated") == Some("true");
                    if !generated && node.attribute("data-mt-key").is_none() {
                        failures.push(format!(
                            "{}: unmapped {}",
                            path.file_name().unwrap().to_string_lossy(),
                            node.attribute("id").unwrap_or("shape")
                        ));
                    }
                }
                for connector in document.descendants().filter(|n| {
                    n.has_tag_name("path")
                        && n.attribute("class")
                            .is_some_and(|c| c.split_whitespace().any(|c| c == "note-edge"))
                }) {
                    assert_eq!(
                        connector.attribute("data-mt-role"),
                        Some("edge"),
                        "{}: note connector lacks activation mapping",
                        path.display()
                    );
                }
                for piece in result["mapping"]["pieces"].as_array().unwrap() {
                    assert!(
                        !selected(&source, &piece["span"]).is_empty(),
                        "{}",
                        path.display()
                    );
                }
                for text in document
                    .descendants()
                    .filter(|n| n.is_text() && n.text().is_some_and(|t| !t.trim().is_empty()))
                {
                    if text.ancestors().any(|n| {
                        ["style", "metadata", "title", "desc"]
                            .iter()
                            .any(|tag| n.has_tag_name(*tag))
                    }) {
                        continue;
                    }
                    if !text.ancestors().any(|n| {
                        n.attribute("data-mt-role")
                            .is_some_and(|role| role.ends_with("-label"))
                    }) {
                        failures.push(format!(
                            "{}: unmapped visible text {:?}",
                            path.file_name().unwrap().to_string_lossy(),
                            text.text()
                        ));
                    }
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn state_ac4_declarations_take_precedence_over_earlier_implicit_references() {
    let source = "stateDiagram-v2\n[*] --> Group\nstate Group {\nA --> B\nA\n}\n";
    let result = mermaid_trace_rs::render("state-declarations", source).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let group_label = pieces
        .iter()
        .find(|p| p["domId"] == "state:label:Group:0")
        .unwrap();
    assert_eq!(
        group_label["span"]["start"],
        source.find("Group {").unwrap()
    );
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    let node = svg
        .descendants()
        .find(|n| n.attribute("data-mt-key") == Some("state:node:A"))
        .unwrap();
    assert_eq!(
        node.attribute("data-mt-start")
            .unwrap()
            .parse::<usize>()
            .unwrap(),
        source.rfind("A\n").unwrap()
    );
}

#[test]
fn state_ac6_configuration_variants_preserve_every_label_and_svg_bytes() {
    for header in ["stateDiagram", "stateDiagram-v2"] {
        for look in ["classic", "handDrawn", "neo"] {
            for html in [false, true] {
                for direction in ["TB", "BT", "LR", "RL"] {
                    let source = format!(
                        "---\nconfig:\n  look: {look}\n  handDrawnSeed: 42\n  htmlLabels: {html}\n---\n{header}\ndirection {direction}\nstate \"Title\" as A\nA : Details\nA --> B : go\nstate Group {{\n  C\n  --\n  D\n}}\n"
                    );
                    let result = mermaid_trace_rs::render("state-variants", &source).unwrap();
                    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                    for region in ["C", "D"] {
                        let piece = result["mapping"]["pieces"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|p| {
                                p["effective"] == true && selected(&source, &p["span"]) == region
                            })
                            .expect("each configured concurrency region has a source block");
                        assert!(
                            svg.descendants()
                                .any(|n| n.attribute("data-mt-key") == piece["domId"].as_str()
                                    && n.attribute("data-mt-role") == Some("node"))
                        );
                    }
                    for label in ["Title", "Details", "C", "D", "Group", "go"] {
                        assert!(
                            svg.descendants().any(|n| n
                                .attribute("data-mt-role")
                                .is_some_and(|r| r.ends_with("-label"))
                                && n.descendants()
                                    .any(|text| text.is_text() && text.text() == Some(label))),
                            "missing {header}/{look}/{html}/{direction}: {label}"
                        );
                    }
                    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                    let baseline =
                        mermaid_trace_rs::render_with(&plain, "state-variants", &source).unwrap();
                    assert_eq!(
                        support::strip_trace(result["svg"].as_str().unwrap()),
                        support::strip_trace(baseline["svg"].as_str().unwrap()),
                        "{header}/{look}/{html}/{direction}"
                    );
                }
            }
        }
    }
}

#[test]
fn state_ac5_frontmatter_title_has_original_yaml_provenance() {
    let source = "---\r\ntitle: \"State 😀 title\"\r\n---\r\nstateDiagram-v2\r\nA --> B\r\n";
    let result = mermaid_trace_rs::render("state-title", source).unwrap();
    let title = result["mapping"]["pieces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["domId"] == "state:title")
        .expect("source-backed title mapping");
    assert_eq!(
        selected(source, &title["span"]),
        "title: \"State 😀 title\""
    );
    assert_eq!(selected(source, &title["labelSpan"]), "State 😀 title");
}

#[test]
fn state_ac5_yaml_title_forms_keep_parser_token_ranges() {
    for (fields, expected) in [
        ("title: Plain 😀\n", "Plain 😀"),
        ("title: 'Quoted 😀'\n", "Quoted 😀"),
        (
            "title: \"Escaped \\\"title\\\"\"\n",
            "Escaped \\\"title\\\"",
        ),
        ("name: &name Alias 😀\ntitle: *name\n", "*name"),
        ("title: |\n  First\n  Second\n", "First\n  Second"),
        ("title: >-\n  First\n  Second\n", "First\n  Second"),
    ] {
        let source = format!("---\n{fields}---\nstateDiagram-v2\nA --> B\n");
        let result = mermaid_trace_rs::render("state-yaml", &source).unwrap();
        let title = result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["domId"] == "state:title")
            .expect("source-backed YAML title");
        assert_eq!(selected(&source, &title["labelSpan"]), expected);
    }
}

#[test]
fn state_ac5_directives_keep_native_relationships_and_nonvisual_classification() {
    let source = "stateDiagram-v2\nclassDef hot fill:red\nA --> B\nclass A,B hot\nstyle B stroke:blue\nclick A href \"https://example.com\"\ndirection LR\naccTitle: States\naccDescr: State metadata\nhide empty description\nscale 350 width\nnote \"Ignored upstream\" as N\n";
    let result = mermaid_trace_rs::render("state-directives", source).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    for (statement, targets) in [
        ("classDef hot fill:red", vec!["A", "B"]),
        ("class A,B hot", vec!["A", "B"]),
        ("style B stroke:blue", vec!["B"]),
        ("click A href \"https://example.com\"", vec!["A"]),
        ("direction LR", vec!["A", "B"]),
    ] {
        for target in targets {
            assert!(pieces.iter().any(|p| p["semanticId"] == target && selected(source, &p["span"]) == statement), "missing {statement} relationship to {target}");
        }
    }
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    let native: Vec<Value> = serde_json::from_str(
        svg.descendants()
            .find_map(|n| n.attribute("data-mt-native"))
            .unwrap(),
    )
    .unwrap();
    for text in [
        "accTitle: States",
        "accDescr: State metadata",
        "hide empty description",
        "scale 350 width",
        "note \"Ignored upstream\" as N",
    ] {
        assert!(
            native
                .iter()
                .any(|p| p["kind"] == "nonvisual" && selected(source, &p["span"]) == text),
            "unclassified {text}"
        );
    }
}

#[test]
fn state_ac4_empty_descriptions_have_no_empty_source_selection() {
    let source = "stateDiagram-v2\nstate \"\" as A\nA :\nA --> B :\nnote left of B :\n";
    let result = mermaid_trace_rs::render("state-empty", source).unwrap();
    for piece in result["mapping"]["pieces"].as_array().unwrap() {
        assert!(!selected(source, &piece["span"]).is_empty());
        if let Some(span) = piece.get("labelSpan") {
            assert!(!selected(source, span).is_empty());
        }
    }
}

#[test]
fn state_ac6_cyclic_hierarchy_with_scoped_direction_returns_a_diagnostic() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let source = "stateDiagram-v2\nstate A {\nstate B {\nA\n}\n}\nstate C {\ndirection LR\nD\n}\n";
    let mut child = Command::new(env!("CARGO_BIN_EXE_mermaid-trace-rs"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(
        child.stdin.take().unwrap(),
        "{}",
        serde_json::json!({"id":"state-cycle","source":source})
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("cyclic state hierarchy hung the renderer instead of returning a diagnostic");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(
        response["error"]
            .as_str()
            .is_some_and(|error| error.contains("Cyclic state hierarchy"))
    );
}

const STATE: &str = "---\r\nconfig:\r\n  theme: default\r\n---\r\nstateDiagram-v2\r\n%% 😀\r\nstate \"Same 😀\" as A\r\nstate \"Same 😀\" as B\r\n[*] --> A\r\nA --> B : review 😀\r\nB --> A\r\nnote right of A : note 😀\r\nstate Group {\r\n  state \"Inner\" as C\r\n  C --> [*]\r\n}\r\n";

#[test]
fn state_struct_ac1_2_native_states_transitions_notes_and_nesting() {
    let result = mermaid_trace_rs::render("structural-state", STATE).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let utf16: Vec<_> = STATE.encode_utf16().collect();
    let slice = |span: &Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let a = pieces
        .iter()
        .find(|p| p["domId"] == "state:node:A" && p.get("labelSpan").is_some())
        .expect("state declaration mapping");
    assert_eq!(slice(&a["span"]), "state \"Same 😀\" as A");
    assert_eq!(slice(&a["labelSpan"]), "Same 😀");
    assert!(
        pieces
            .iter()
            .any(|p| p["semanticId"] == "B" && slice(&p["labelSpan"]) == "Same 😀")
    );
    let transitions: Vec<_> = pieces.iter().filter(|p| p["kind"] == "edge").collect();
    assert_eq!(
        transitions
            .iter()
            .map(|p| slice(&p["span"]))
            .collect::<Vec<_>>(),
        [
            "[*] --> A",
            "A --> B : review 😀",
            "B --> A",
            "note right of A : note 😀",
            "C --> [*]"
        ]
    );
    assert_eq!(slice(&transitions[1]["labelSpan"]), "review 😀");
    assert_eq!(transitions[1]["from"], "A");
    assert_eq!(transitions[1]["to"], "B");
    assert!(
        pieces
            .iter()
            .any(|p| slice(&p["span"]) == "note right of A : note 😀"
                && slice(&p["labelSpan"]) == "note 😀")
    );
    assert!(
        pieces
            .iter()
            .any(|p| p["semanticId"] == "C" && p["parentId"] == "Group")
    );
    assert!(
        pieces
            .iter()
            .any(|p| p["domId"] == "state:node:Group" && slice(&p["labelSpan"]) == "Group")
    );
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    assert!(
        svg.descendants()
            .any(|n| n.has_tag_name("path") && n.attribute("data-mt-role") == Some("edge"))
    );
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let baseline = mermaid_trace_rs::render_with(&plain, "structural-state", STATE).unwrap();
    assert_eq!(
        support::strip_trace(result["svg"].as_str().unwrap()),
        support::strip_trace(baseline["svg"].as_str().unwrap())
    );
}

#[test]
fn state_struct_ac1_2_special_states_and_multiline_notes_bind_native_identity() {
    for header in ["stateDiagram", "stateDiagram-v2"] {
        let source = format!(
            "{header}\n[*] --> Decision\nstate Decision <<choice>>\nstate Fork <<fork>>\nstate Join <<join>>\nDecision --> Fork : yes\nFork --> Join\nJoin --> [*]\nnote left of Decision\n  First 😀\n  Second\nend note\n"
        );
        let result = mermaid_trace_rs::render("state-special", &source).unwrap();
        let pieces = result["mapping"]["pieces"].as_array().unwrap();
        for id in ["root_start", "root_end", "Decision", "Fork", "Join"] {
            assert!(
                pieces
                    .iter()
                    .any(|p| p["domId"] == format!("state:node:{id}")),
                "missing {header} {id}"
            );
        }
        let utf16: Vec<_> = source.encode_utf16().collect();
        let note = pieces
            .iter()
            .find(|p| p["kind"] == "control")
            .expect("native note");
        let label = &note["labelSpan"];
        assert_eq!(
            String::from_utf16(
                &utf16[label["start"].as_u64().unwrap() as usize
                    ..label["end"].as_u64().unwrap() as usize]
            )
            .unwrap(),
            "First 😀\n  Second"
        );
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        for piece in pieces {
            assert!(
                svg.descendants()
                    .any(|n| n.attribute("data-mt-key") == piece["domId"].as_str())
            );
        }
    }
}

#[test]
fn state_region_background_maps_its_own_statements() {
    for header in ["stateDiagram", "stateDiagram-v2"] {
        let left = "state \"Draft 😀\" as Draft: Editable content\r\n    Draft : Can be revised\r\n    state Review\r\n    [*] --> Draft\r\n    Draft --> Review : submit\r\n    Review --> Draft : revise\r\n    Review --> [*] : approve";
        let right = "[*] --> Indexing\r\n    Indexing --> [*] : indexed";
        let source = format!(
            "{header}\r\n[*] --> Editing\r\nstate Editing {{\r\n    {left}\r\n    --\r\n    {right}\r\n}}\r\nEditing --> Published : publish\r\nPublished --> [*]\r\nnote right of Published : Available to readers\r\n"
        );
        let rendered = mermaid_trace_rs::render("state-regions", &source).unwrap();
        let doc = roxmltree::Document::parse(rendered["svg"].as_str().unwrap()).unwrap();
        let pieces = rendered["mapping"]["pieces"].as_array().unwrap();
        for expected in [left, right] {
            let piece = pieces
                .iter()
                .find(|p| {
                    p["domId"].as_str().unwrap().starts_with("state:node:")
                        && selected(&source, &p["span"]) == expected
                })
                .expect("each grey region has its own authored block");
            assert!(
                doc.descendants()
                    .any(|n| n.attribute("data-mt-key") == piece["domId"].as_str()
                        && n.attribute("data-mt-role") == Some("node")),
                "region must be an activation target"
            );
        }
    }
}

#[test]
fn state_regions_preserve_nested_empty_and_separator_occurrences() {
    let inner = "state Inner {\r\n    X\r\n    --\r\n    Y\r\n  }";
    let source = format!(
        "stateDiagram-v2\r\n%% 😀\r\nstate Outer {{\r\n  --\r\n  --\r\n  {inner}\r\n  --\r\n  Z\r\n}}\r\n"
    );
    let result = mermaid_trace_rs::render("state-nested-regions", &source).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    for text in [inner, "X", "Y", "Z"] {
        assert!(
            pieces
                .iter()
                .any(|p| p["effective"] == true && selected(&source, &p["span"]) == text),
            "region {text}"
        );
    }
    let separators: Vec<_> = pieces
        .iter()
        .filter(|p| selected(&source, &p["span"]) == "--")
        .collect();
    assert_eq!(
        separators.len(),
        4,
        "empty regions and all real separators retain source relationships"
    );
    let doc = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    for piece in separators {
        assert!(
            doc.descendants()
                .any(|n| n.attribute("data-mt-key") == piece["domId"].as_str()
                    && n.attribute("data-mt-role") == Some("node"))
        );
    }
}

#[test]
fn state_note_connectors_map_the_owning_note_statement() {
    for header in ["stateDiagram", "stateDiagram-v2"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for position in ["left", "right"] {
                    for multiline in [false, true] {
                        let note = if multiline {
                            format!("note {position} of A\r\n  Same 😀\r\n  second row\r\nend note")
                        } else {
                            format!("note {position} of A : Same 😀")
                        };
                        let composite = format!("note {position} of Group : Same 😀");
                        let source = format!(
                            "---\r\nconfig:\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\nstate A\r\nstate Group {{\r\n  B\r\n}}\r\n{note}\r\n{composite}\r\n"
                        );
                        let result = mermaid_trace_rs::render("state-note-edges", &source).unwrap();
                        let svg =
                            roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                        let pieces = result["mapping"]["pieces"].as_array().unwrap();
                        let paths: Vec<_> = svg
                            .descendants()
                            .filter(|n| {
                                n.has_tag_name("path")
                                    && n.attribute("class").is_some_and(|c| {
                                        c.split_whitespace().any(|c| c == "note-edge")
                                    })
                            })
                            .collect();
                        assert_eq!(paths.len(), 2);
                        let mut spans = Vec::new();
                        for path in paths {
                            assert_eq!(
                                path.attribute("data-mt-role"),
                                Some("edge"),
                                "dashed note connector must be selectable"
                            );
                            let piece = pieces
                                .iter()
                                .find(|p| p["id"] == path.attribute("data-mt-refs").unwrap())
                                .unwrap();
                            assert!(
                                piece.get("labelSpan").is_none(),
                                "a note connector has no transition label"
                            );
                            spans.push(selected(&source, &piece["span"]));
                        }
                        spans.sort();
                        let mut expected = vec![note, composite];
                        expected.sort();
                        assert_eq!(spans, expected);
                        let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                        let baseline =
                            mermaid_trace_rs::render_with(&plain, "state-note-edges", &source)
                                .unwrap();
                        assert_eq!(
                            support::strip_trace(result["svg"].as_str().unwrap()),
                            support::strip_trace(baseline["svg"].as_str().unwrap())
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn state_note_attachment_tokens_belong_to_the_note_not_the_state() {
    for header in ["stateDiagram", "stateDiagram-v2"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for position in ["left", "right"] {
                    for multiline in [false, true] {
                        let note = if multiline {
                            format!("note {position} of Published\r\n  Available 😀\r\nend note")
                        } else {
                            format!("note {position} of Published : Available 😀")
                        };
                        let source = format!(
                            "---\r\nconfig:\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\nEditing --> Published : publish\r\nPublished --> [*]\r\n{note}\r\n"
                        );
                        let result = mermaid_trace_rs::render("note-ownership", &source).unwrap();
                        let start = source[..source.find(&note).unwrap()].encode_utf16().count();
                        let end = start + note.encode_utf16().count();
                        let pieces = result["mapping"]["pieces"].as_array().unwrap();
                        assert!(
                            !pieces.iter().any(|piece| piece["kind"] == "node"
                                && piece["span"]["start"].as_u64().unwrap() < end as u64
                                && piece["span"]["end"].as_u64().unwrap() > start as u64),
                            "note properties must not select the referenced state"
                        );
                        assert!(
                            pieces.iter().any(|piece| piece["kind"] == "control"
                                && piece["span"] == serde_json::json!({"start":start,"end":end})),
                            "the whole note statement owns its attachment token"
                        );
                        assert!(
                            pieces.iter().any(|piece| piece["semanticId"] == "Published"
                                && selected(&source, &piece["span"]) == "Published"),
                            "real state references remain mapped"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn state_notes_do_not_supply_another_states_declaration_or_label_origin() {
    for suffix in ["", "\nPublished --> [*]", "\nPublished"] {
        let note = "note right of Published : Available 😀";
        let source = format!("stateDiagram-v2\n{note}{suffix}\n");
        let result = mermaid_trace_rs::render("note-first", &source).unwrap();
        let pieces = result["mapping"]["pieces"].as_array().unwrap();
        let note_end = ("stateDiagram-v2\n".to_owned() + note)
            .encode_utf16()
            .count();
        assert!(
            !pieces
                .iter()
                .any(|p| p["kind"] == "node"
                    && p["span"]["start"].as_u64().unwrap() < note_end as u64),
            "note syntax is owned only by the note"
        );
        if !suffix.is_empty() {
            assert!(
                pieces
                    .iter()
                    .any(|p| p["domId"] == "state:label:Published:0"
                        && p["span"]["start"].as_u64().unwrap() >= note_end as u64),
                "a later real state occurrence supplies the default label origin"
            );
        } else {
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let native: Vec<Value> = serde_json::from_str(
                svg.descendants()
                    .find_map(|n| n.attribute("data-mt-native"))
                    .unwrap(),
            )
            .unwrap();
            assert!(
                native.iter().any(|p| p["kind"] == "decoration"
                    && p["semanticId"] == "Published"
                    && p["classification"] == "note-implied-anchor"),
                "the native generated anchor has no invented declaration"
            );
        }
    }
}

#[test]
fn state_note_only_anchor_preserves_later_style_relationships_without_claiming_note_syntax() {
    let source = "stateDiagram-v2\nnote right of Published : Available\nstyle Published fill:red\n";
    let result = mermaid_trace_rs::render("note-style", source).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    assert!(
        pieces.iter().any(|p| p["semanticId"] == "Published"
            && selected(source, &p["span"]) == "style Published fill:red"),
        "the real style statement keeps its visual relationship"
    );
    assert!(
        !pieces
            .iter()
            .any(|p| p["kind"] == "node" && selected(source, &p["span"]) == "Published"),
        "a note attachment must not become a state selection"
    );
}

#[test]
fn own_state_declared_endpoint_references_belong_to_the_transition() {
    for header in ["stateDiagram", "stateDiagram-v2"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for prefix in [
                    "A\r\nB\r\n",
                    "state \"Alpha 😀\" as A\r\nstate \"Beta\" as B\r\n",
                    "state A {\r\nC\r\n}\r\nB\r\n",
                    "state A <<choice>>\r\nstate B <<fork>>\r\n",
                    "A --> B : create\r\n",
                    "note right of A : Before creation\r\nA --> B : create\r\n",
                ] {
                    for nested in [false, true] {
                        let body = format!(
                            "{prefix}A --> B : go\r\nB --> A : return\r\nA --> A : self\r\nA --> B : parallel\r\n"
                        );
                        let body = if nested {
                            format!("state Outer {{\r\n{body}}}\r\n")
                        } else {
                            body
                        };
                        let source = format!(
                            "---\r\nconfig:\r\n  look: {look}\r\n  handDrawnSeed: 42\r\n  htmlLabels: {html}\r\n---\r\n{header}\r\n{body}"
                        );
                        let result = mermaid_trace_rs::render("state-ref-owner", &source).unwrap();
                        let pieces = result["mapping"]["pieces"].as_array().unwrap();
                        for statement in [
                            "A --> B : go",
                            "B --> A : return",
                            "A --> A : self",
                            "A --> B : parallel",
                        ] {
                            let byte = source.find(statement).unwrap();
                            for offset in [0, 6] {
                                let start = source[..byte + offset].encode_utf16().count();
                                let span = serde_json::json!({"start":start,"end":start+1});
                                assert!(
                                    !pieces
                                        .iter()
                                        .any(|p| p["kind"] == "node" && p["span"] == span),
                                    "reference-only endpoint must not select its target node: {source}"
                                );
                            }
                            let edge = pieces
                                .iter()
                                .find(|p| {
                                    p["kind"] == "edge"
                                        && selected(&source, &p["span"]) == statement
                                })
                                .unwrap();
                            assert_eq!(edge["from"], &statement[..1]);
                            assert_eq!(edge["to"], &statement[6..7]);
                        }
                        for id in ["A", "B"] {
                            assert!(
                                pieces
                                    .iter()
                                    .any(|p| p["kind"] == "node" && p["semanticId"] == id),
                                "real state declarations remain mapped"
                            );
                        }
                    }
                }
            }
        }
    }
}
