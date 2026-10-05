mod support;

use merman::{OperationControl, RenderOutput, RenderRequest, Renderer, SvgRequest};

#[test]
fn seq_ac1_2_parser_provenance_survives_native_rendering() {
    let source = "sequenceDiagram\r\n%% 😀 comment\r\nparticipant A as Same\r\nparticipant B as Same\r\nA->>B: same\r\nB-->>A: same\r\n";
    let RenderOutput::Svg(Some(output)) = Renderer::new()
        .with_engine(
            merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(
                serde_json::json!({"traceSource":true}),
            )),
        )
        .render(RenderRequest::svg(
            source,
            OperationControl::new(),
            SvgRequest::default(),
        ))
        .unwrap()
    else {
        panic!("missing SVG")
    };
    let svg = roxmltree::Document::parse(output.svg()).unwrap();
    let payload = svg
        .descendants()
        .find_map(|n| n.attribute("data-mt-native"))
        .expect("native sequence provenance");
    let map: serde_json::Value = serde_json::from_str(payload).unwrap();
    let pieces = map.as_array().unwrap();
    let messages: Vec<_> = pieces.iter().filter(|p| p["kind"] == "edge").collect();
    assert_eq!(messages.len(), 2);
    for (p, expected) in messages.iter().zip(["A->>B: same", "B-->>A: same"]) {
        assert_eq!(
            &source[p["span"]["start"].as_u64().unwrap() as usize
                ..p["span"]["end"].as_u64().unwrap() as usize],
            expected
        );
        assert_eq!(
            &source[p["labelSpan"]["start"].as_u64().unwrap() as usize
                ..p["labelSpan"]["end"].as_u64().unwrap() as usize],
            "same"
        );
    }
    assert_ne!(messages[0]["semanticId"], messages[1]["semanticId"]);
}

#[test]
fn seq_ac2_3_saved_svg_binds_native_pieces_and_utf16_ranges() {
    let source = "sequenceDiagram\r\n%% 😀\r\nparticipant A as Same\r\nactor B as Same\r\nloop outer\r\nA->>+B: same😀\r\nnote over B: same\r\nopt inner\r\nB-->>-A: same😀\r\nend\r\nend\r\nA->>A: \r\n";
    let result = mermaid_trace_rs::render("sequence-test", source).unwrap();
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    let map: serde_json::Value = serde_json::from_str(&percent_decode(
        svg.root_element().attribute("data-mt-map").unwrap(),
    ))
    .unwrap();
    assert_eq!(map["source"], source);
    assert_eq!(map["format"], "mermaid-trace/1");
    let pieces = map["pieces"].as_array().unwrap();
    for kind in ["node", "edge", "note", "activation", "control"] {
        assert!(pieces.iter().any(|p| p["kind"] == kind), "missing {kind}");
    }
    let edges: Vec<_> = pieces.iter().filter(|p| p["kind"] == "edge").collect();
    let utf16: Vec<_> = source.encode_utf16().collect();
    for (p, expected) in edges
        .iter()
        .zip(["A->>+B: same😀", "B-->>-A: same😀", "A->>A: "])
    {
        assert_eq!(
            String::from_utf16(
                &utf16[p["span"]["start"].as_u64().unwrap() as usize
                    ..p["span"]["end"].as_u64().unwrap() as usize]
            )
            .unwrap(),
            expected
        );
    }
    let connector = svg
        .descendants()
        .find(|n| n.attribute("data-mt-role") == Some("edge") && n.has_tag_name("line"))
        .unwrap();
    let label = svg
        .descendants()
        .find(|n| n.attribute("data-mt-role") == Some("edge-label"))
        .unwrap();
    assert_eq!(
        connector.attribute("data-mt-refs"),
        label.attribute("data-mt-refs")
    );
    assert_ne!(
        connector.attribute("data-mt-start"),
        label.attribute("data-mt-start")
    );
    assert!(!svg.descendants().any(|n| n.has_tag_name("script")));
    assert_eq!(
        mermaid_trace_rs::render("sequence-test", source).unwrap(),
        result
    );
    assert!(mermaid_trace_rs::render("bad\"", source).is_err());
    assert!(mermaid_trace_rs::render("bad", "sequenceDiagram\nA->>").is_err());
}

fn percent_decode(value: &str) -> String {
    let mut bytes = Vec::new();
    let mut i = 0;
    while i < value.len() {
        if value.as_bytes()[i] == b'%' {
            bytes.push(u8::from_str_radix(&value[i + 1..i + 3], 16).unwrap());
            i += 3;
        } else {
            bytes.push(value.as_bytes()[i]);
            i += 1;
        }
    }
    String::from_utf8(bytes).unwrap()
}

#[test]
fn seq_ac1_preprocessing_and_control_variants_keep_original_positions() {
    let source = "---\r\nconfig:\r\n  theme: default\r\n---\r\nsequenceDiagram\r\nbox rgb(220,220,220) Group\r\nparticipant A as Café 😀\r\nparticipant B\r\nend\r\nrect rgb(240,240,240)\r\nalt same\r\n%% removed comment inside a control\r\nA->>B: wrap: same & same\r\nelse same\r\nB->>A: same\r\nend\r\npar same\r\nA->>B: same\r\nand same\r\nB->>A: same\r\nend\r\ncritical same\r\nA->>B: same\r\noption same\r\nB->>A: same\r\nend\r\nbreak same\r\nA->>B: same\r\nend\r\nend\r\n";
    let result = mermaid_trace_rs::render("variants", source).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    assert!(
        pieces.iter().any(|p| p["domId"] == "box:0"),
        "box provenance"
    );
    let utf16: Vec<_> = source.encode_utf16().collect();
    let selected = |span: &serde_json::Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let actor = pieces.iter().find(|p| p["semanticId"] == "A").unwrap();
    assert_eq!(selected(&actor["labelSpan"]), "Café 😀");
    let labels: Vec<_> = pieces
        .iter()
        .filter(|p| p["kind"] == "control" && p.get("labelSpan").is_some())
        .map(|p| selected(&p["labelSpan"]))
        .collect();
    assert_eq!(labels.iter().filter(|text| *text == "same").count(), 7);
    let edges: Vec<_> = pieces.iter().filter(|p| p["kind"] == "edge").collect();
    assert_eq!(edges.len(), 7);
    assert_eq!(
        selected(&edges[0]["labelSpan"]),
        "same & same",
        "wrap prefix is syntax, not label"
    );
    assert_eq!(edges[0]["from"], "A");
    assert_eq!(edges[0]["to"], "B");
}

#[test]
fn own_seq_note_attachments_do_not_declare_or_label_participants() {
    let plain = Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"traceSource":false,"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for attachment in ["left of A", "right of A", "over A", "over A,B"] {
        for (prefix, suffix) in [
            ("", ""),
            ("", "A->>B: Real message\r\n"),
            ("", "participant A as Declared\r\nparticipant B\r\n"),
            ("participant A\r\nparticipant B\r\n", ""),
        ] {
            let note = format!("note {attachment}: Available 😀");
            let source = format!("sequenceDiagram\r\n{prefix}{note}\r\n{suffix}");
            let result = mermaid_trace_rs::render("note-owner", &source).unwrap();
            let untraced = mermaid_trace_rs::render_with(&plain, "note-owner", &source).unwrap();
            assert_eq!(
                support::strip_trace(result["svg"].as_str().unwrap()),
                support::strip_trace(untraced["svg"].as_str().unwrap())
            );
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            let start = source[..source.find(&note).unwrap()].encode_utf16().count() as u64;
            let end = start + note.encode_utf16().count() as u64;
            assert!(
                !pieces.iter().any(|p| p["kind"] == "node"
                    && p["span"]["start"].as_u64().unwrap() < end
                    && p["span"]["end"].as_u64().unwrap() > start),
                "note attachment syntax belongs to the note: {source}"
            );
            let owner = pieces.iter().find(|p| p["kind"] == "note").unwrap();
            assert_eq!(
                owner["targets"],
                if attachment == "over A,B" {
                    serde_json::json!(["A", "B"])
                } else if attachment == "over A" {
                    serde_json::json!(["A", "A"])
                } else {
                    serde_json::json!(["A"])
                }
            );
            assert_eq!(owner["span"], serde_json::json!({"start":start,"end":end}));
            if !prefix.is_empty() || !suffix.is_empty() {
                assert!(
                    pieces
                        .iter()
                        .any(|p| p["kind"] == "node" && p["semanticId"] == "A")
                );
            }
        }
    }
}

#[test]
fn seq_title_preserves_body_occurrences_and_frontmatter_fallback() {
    for (prefix, titles, expected, count) in [
        ("", "title Example 😀\r\n", "Example 😀", 1),
        ("", "title: Example 😀\r\n", "Example 😀", 1),
        ("", "title First\r\ntitle Second\r\n", "Second", 2),
        ("---\r\ntitle: 'Front 😀'\r\n---\r\n", "", "Front 😀", 1),
        (
            "---\r\ntitle: Front\r\n---\r\n",
            "title Body\r\n",
            "Body",
            1,
        ),
        ("---\r\ntitle: Front\r\n---\r\n", "title: \r\n", "Front", 1),
    ] {
        let source =
            format!("{prefix}sequenceDiagram\r\n{titles}participant A\r\nA->>B: Hello\r\n");
        let result = mermaid_trace_rs::render("seq-title", &source).unwrap();
        let pieces = result["mapping"]["pieces"].as_array().unwrap();
        let title: Vec<_> = pieces
            .iter()
            .filter(|p| p["domId"] == "sequence:title")
            .collect();
        assert_eq!(title.len(), count, "{source}");
        let effective = title
            .iter()
            .find(|p| p["effective"] == true)
            .unwrap_or(&title[0]);
        let span = &effective["labelSpan"];
        let utf16: Vec<_> = source.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(
                &utf16[span["start"].as_u64().unwrap() as usize
                    ..span["end"].as_u64().unwrap() as usize]
            )
            .unwrap(),
            expected
        );
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let text = svg
            .descendants()
            .find(|n| n.attribute("data-mt-key") == Some("sequence:title"))
            .unwrap();
        assert_eq!(support::text_content(text), expected);
        assert_eq!(
            text.attribute("data-mt-start")
                .unwrap()
                .parse::<u64>()
                .unwrap(),
            span["start"].as_u64().unwrap()
        );
        let plain = Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
        let baseline = mermaid_trace_rs::render_with(&plain, "seq-title", &source).unwrap();
        assert_eq!(
            support::strip_trace(result["svg"].as_str().unwrap()),
            support::strip_trace(baseline["svg"].as_str().unwrap())
        );
    }
}

#[test]
fn seq_participant_alias_spans_follow_canonical_config_and_as_precedence() {
    for (config, suffix, expected) in [
        (r#"alias: "Client 😀", type: boundary"#, "", "Client 😀"),
        (r#"alias: "Cli\u0065nt""#, "", r#"Cli\u0065nt"#),
        ("alias: 42", "", "42"),
        ("alias: true", "", "true"),
        ("alias: Ignored", " as Explicit 😀", "Explicit 😀"),
        ("alias: null", "", "A"),
    ] {
        for declaration in ["participant", "actor", "create participant"] {
            let source = format!(
                "sequenceDiagram\r\n%% 😀\r\n{declaration} A@{{ {config} }}{suffix}\r\nB->>A: Hello\r\n"
            );
            let result = mermaid_trace_rs::render("seq-alias", &source).unwrap();
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            let actor = pieces.iter().find(|p| p["domId"] == "actor:A").unwrap();
            let start = if expected == "A" {
                source.find("A@{").unwrap()
            } else {
                source.find(expected).unwrap()
            };
            assert_eq!(
                actor["labelSpan"],
                serde_json::json!({"start":source[..start].encode_utf16().count(),"end":source[..start+expected.len()].encode_utf16().count()}),
                "{source}"
            );
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let label = svg
                .descendants()
                .find(|n| {
                    n.attribute("data-mt-role") == Some("node-label")
                        && n.attribute("data-mt-refs") == actor["id"].as_str()
                })
                .unwrap();
            assert_eq!(
                label
                    .attribute("data-mt-start")
                    .unwrap()
                    .parse::<u64>()
                    .unwrap(),
                actor["labelSpan"]["start"].as_u64().unwrap()
            );
            let plain = Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline = mermaid_trace_rs::render_with(&plain, "seq-alias", &source).unwrap();
            assert_eq!(
                support::strip_trace(result["svg"].as_str().unwrap()),
                support::strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
}

#[test]
fn seq_participant_redeclarations_preserve_every_origin_and_effective_label() {
    for first in [
        "participant A as First",
        "participant A as Second",
        "A->>B: Hello",
    ] {
        let source = format!(
            "sequenceDiagram\r\n%% 😀\r\n{first}\r\nparticipant A as Second\r\nA->>B: Done\r\n"
        );
        let result = mermaid_trace_rs::render("seq-declarations", &source).unwrap();
        let pieces = result["mapping"]["pieces"].as_array().unwrap();
        let actors: Vec<_> = pieces.iter().filter(|p| p["domId"] == "actor:A").collect();
        assert_eq!(actors.len(), 2, "{source}");
        assert_eq!(actors[0]["effective"], false);
        assert_eq!(actors[1]["effective"], true);
        assert_ne!(actors[0]["id"], actors[1]["id"]);
        let utf16: Vec<_> = source.encode_utf16().collect();
        let slice = |span: &serde_json::Value| {
            String::from_utf16(
                &utf16[span["start"].as_u64().unwrap() as usize
                    ..span["end"].as_u64().unwrap() as usize],
            )
            .unwrap()
        };
        assert_eq!(
            slice(&actors[0]["span"]),
            if first.starts_with("participant") {
                first
            } else {
                "A"
            }
        );
        assert_eq!(slice(&actors[1]["span"]), "participant A as Second");
        assert_eq!(slice(&actors[1]["labelSpan"]), "Second");
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        for label in svg.descendants().filter(|n| {
            n.attribute("data-mt-role") == Some("node-label")
                && n.ancestors()
                    .any(|n| n.attribute("data-mt-key") == Some("actor:A"))
        }) {
            assert_eq!(label.attribute("data-mt-refs"), actors[1]["id"].as_str());
        }
        let bodies: Vec<_> = svg
            .descendants()
            .filter(|n| {
                n.attribute("data-mt-key") == Some("actor:A")
                    && n.attribute("data-mt-role") == Some("node")
            })
            .collect();
        assert!(!bodies.is_empty());
        for body in bodies {
            assert!(
                body.attribute("data-mt-refs")
                    .unwrap()
                    .contains(actors[0]["id"].as_str().unwrap())
            );
        }
    }
}
