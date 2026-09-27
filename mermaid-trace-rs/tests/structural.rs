mod support;
use serde_json::Value;

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
        ["[*] --> A", "A --> B : review 😀", "B --> A", "C --> [*]"]
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
