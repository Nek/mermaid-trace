use merman::{Engine, MermaidConfig, Renderer};
use serde_json::json;
mod support;

#[test]
fn trusted_css_variables_match_concrete_fonts_in_html_and_svg_labels() {
    let source = "flowchart LR\r\n%% 😀\r\nsubgraph G[Group WWWiii]\r\nA[Alpha WWWiii] e@-->|Next WWWiii| B[Beta]\r\nend\r\n";
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            for look in ["classic", "neo", "handDrawn"] {
                let draw = |variables, input, trace| {
                    let (size, family) = if variables {
                        ("var(--Size)", "var(--Font)")
                    } else {
                        ("32px", "monospace")
                    };
                    let css = format!(
                        ".root{{--Size:32px;--Font:monospace}} .label text,.nodeLabel,.edgeLabel,.cluster-label{{font-size:{size};font-family:{family}}}"
                    );
                    let renderer = Renderer::new().with_engine(Engine::new().with_site_config(MermaidConfig::from_value(json!({"layout":layout,"look":look,"handDrawnSeed":42,"htmlLabels":html,"themeCSS":css,"traceSource":trace}))));
                    mermaid_trace_rs::render_with(&renderer, "css-variables", input).unwrap()
                };
                let actual = draw(true, source, true);
                let expected = draw(false, source, true);
                assert_eq!(actual["mapping"]["source"], source);
                assert_eq!(
                    support::strip_trace(actual["svg"].as_str().unwrap()),
                    support::strip_trace(draw(true, source, false)["svg"].as_str().unwrap())
                );
                let doc = roxmltree::Document::parse(actual["svg"].as_str().unwrap()).unwrap();
                let utf16: Vec<_> = source.encode_utf16().collect();
                for (role, expected) in [
                    ("node-label", "Alpha WWWiii"),
                    ("edge-label", "Next WWWiii"),
                    ("control-label", "Group WWWiii"),
                ] {
                    let label = doc
                        .descendants()
                        .find(|n| n.attribute("data-mt-role") == Some(role))
                        .unwrap();
                    let start: usize = label.attribute("data-mt-start").unwrap().parse().unwrap();
                    let end: usize = label.attribute("data-mt-end").unwrap().parse().unwrap();
                    assert_eq!(String::from_utf16(&utf16[start..end]).unwrap(), expected);
                }
                if let Ok(directory) = std::env::var("TRACE_CSS_LAYER_ARTIFACTS") {
                    // Markdown fences expose normalized logical source to the producer.
                    let browser_artifact = draw(true, &source.replace("\r\n", "\n"), true);
                    for (label, role) in [
                        ("Alpha WWWiii", "node-label"),
                        ("Next WWWiii", "edge-label"),
                        ("Group WWWiii", "control-label"),
                    ] {
                        let mut artifact = browser_artifact.clone();
                        artifact["fixture"] = json!({"label": label, "role": role});
                        std::fs::write(
                            std::path::Path::new(&directory)
                                .join(format!("variables-{layout}-{html}-{look}-{role}.json")),
                            serde_json::to_vec(&artifact).unwrap(),
                        )
                        .unwrap();
                    }
                }
                let normalized = actual["svg"]
                    .as_str()
                    .unwrap()
                    .replace("var(--Size)", "32px")
                    .replace("var(--Font)", "monospace");
                assert!(
                    normalized == expected["svg"].as_str().unwrap(),
                    "{layout}/html={html}/{look}: CSS variables must preserve concrete font geometry and embedded fonts"
                );
            }
        }
    }
}
