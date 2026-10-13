mod support;

use merman::{Engine, MermaidConfig, Renderer};
use serde_json::{Value, json};

#[test]
fn browser_host_controls_preserve_explicit_rendering_and_errors() {
    let mut controls: Vec<Value> = ["trace", "debug", "info", "warn", "error", "fatal"]
        .into_iter()
        .enumerate()
        .flat_map(|(number, name)| [json!({"logLevel":number}), json!({"logLevel":name})])
        .collect();
    for start in [false, true] {
        for suppress in [false, true] {
            controls
                .push(json!({"startOnLoad":start,"suppressErrorRendering":suppress,"logLevel":0}));
        }
    }
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            let base = json!({"layout":layout,"htmlLabels":html,"traceSource":true});
            let make = |config| {
                Renderer::new()
                    .with_engine(Engine::new().with_site_config(MermaidConfig::from_value(config)))
            };
            let body = "flowchart LR\r\n%% 😀\r\nsubgraph G[Group]\r\nA[Alpha 😀] e@-->|next| B[Beta]\r\nend\r\n";
            let baseline =
                mermaid_trace_rs::render_with(&make(base.clone()), "controls", body).unwrap();
            for config in &controls {
                for origin in ["site", "frontmatter", "directive"] {
                    let mut site = base.clone();
                    let prefix = match origin {
                        "site" => {
                            site.as_object_mut()
                                .unwrap()
                                .extend(config.as_object().unwrap().clone());
                            String::new()
                        }
                        "frontmatter" => format!("---\r\nconfig: {config}\r\n---\r\n"),
                        _ => format!("%%{{init: {config}}}%%\r\n"),
                    };
                    let renderer = make(site.clone());
                    let source = format!("{prefix}{body}");
                    let result =
                        mermaid_trace_rs::render_with(&renderer, "controls", &source).unwrap();
                    assert!(
                        support::strip_trace(result["svg"].as_str().unwrap())
                            == support::strip_trace(baseline["svg"].as_str().unwrap()),
                        "{layout}/{html}/{origin}/{config}: host controls must not alter the drawing"
                    );
                    assert_eq!(result["mapping"]["source"], source);
                    let start = source[..source.find("Alpha 😀").unwrap()]
                        .encode_utf16()
                        .count();
                    let span = json!({"start":start,"end":start+"Alpha 😀".encode_utf16().count()});
                    assert!(
                        result["mapping"]["pieces"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|piece| piece["labelSpan"] == span)
                    );
                    let document =
                        roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                    assert!(!document.descendants().any(|node| {
                        node.has_tag_name("script")
                            || node
                                .attributes()
                                .any(|attribute| attribute.name().starts_with("on"))
                    }));
                    site["traceSource"] = json!(false);
                    let plain =
                        mermaid_trace_rs::render_with(&make(site), "controls", &source).unwrap();
                    assert!(
                        support::strip_trace(result["svg"].as_str().unwrap())
                            == support::strip_trace(plain["svg"].as_str().unwrap()),
                        "mapped/plain parity"
                    );
                    let invalid = format!("{prefix}flowchart LR\r\nA[");
                    assert!(
                        mermaid_trace_rs::render_with(&renderer, "controls", &invalid).is_err(),
                        "{origin}/{config}: syntax errors must never become successful error SVGs"
                    );
                    assert_eq!(
                        result,
                        mermaid_trace_rs::render_with(&renderer, "controls", &source).unwrap(),
                        "an error must not poison subsequent requests"
                    );
                }
            }
        }
    }
}
