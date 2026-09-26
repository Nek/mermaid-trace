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
