mod support;

use serde_json::json;

#[test]
fn sanitizer_subtree_policy_filters_rendered_labels_without_rewriting_source() {
    let label = "<div>Hidden <b>nested</b></div>Alpha 😀";
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            for option in ["FORBID_CONTENTS", "ADD_FORBID_CONTENTS"] {
                let config = json!({"layout":layout,"htmlLabels":html,"dompurifyConfig":{"FORBID_TAGS":["div"],option:["DIV"]}});
                for from_source in [false, true] {
                    let body =
                        format!("%% Original 😀\r\nflowchart LR\r\nA[\"{label}\"] --> B[Beta]");
                    let source = if from_source {
                        format!("---\r\nconfig: {config}\r\n---\r\n{body}")
                    } else {
                        body
                    };
                    let render = |trace| {
                        let mut site = if from_source {
                            json!({})
                        } else {
                            config.clone()
                        };
                        site["traceSource"] = json!(trace);
                        let renderer = merman::Renderer::new().with_engine(
                            merman::Engine::new()
                                .with_site_config(merman::MermaidConfig::from_value(site)),
                        );
                        mermaid_trace_rs::render_with(&renderer, "sanitizer-content", &source)
                            .unwrap()
                    };
                    let mapped = render(true);
                    let plain = render(false);
                    let svg = mapped["svg"].as_str().unwrap();
                    let doc = roxmltree::Document::parse(svg).unwrap();
                    let text: String = doc
                        .descendants()
                        .filter(|n| n.has_tag_name("text"))
                        .map(support::text_content)
                        .collect();
                    assert!(
                        text.contains("Alpha 😀"),
                        "{layout} {html} {option}: {text}"
                    );
                    assert!(
                        !text.contains("Hidden") && !text.contains("nested"),
                        "{layout} {html} {option}: {text}"
                    );
                    assert_eq!(mapped["mapping"]["source"], source);
                    let start = source[..source.find(label).unwrap()].encode_utf16().count();
                    let span = json!({"start":start,"end":start+label.encode_utf16().count()});
                    assert!(
                        mapped["mapping"]["pieces"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|piece| piece["labelSpan"] == span)
                    );
                    assert_eq!(
                        support::strip_trace(svg),
                        support::strip_trace(plain["svg"].as_str().unwrap())
                    );
                }
            }
        }
    }
}
