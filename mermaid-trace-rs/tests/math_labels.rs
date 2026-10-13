mod support;

use merman::{Engine, MermaidConfig, Renderer};
use serde_json::json;

#[test]
fn multiple_formula_node_width_tracks_emitted_geometry_and_legacy_flags_are_inert() {
    for layout in ["dagre", "elk"] {
        for font_size in [16, 32] {
            let mut baseline = None;
            for legacy in [false, true] {
                for forced in [false, true] {
                    let config = json!({"layout":layout,"fontSize":font_size,"htmlLabels":true,"legacyMathML":legacy,"forceLegacyMathML":forced});
                    for site_config in [false, true] {
                        let mut site = json!({"traceSource":true,"htmlLabels":true});
                        let prefix = if site_config {
                            site.as_object_mut()
                                .unwrap()
                                .extend(config.as_object().unwrap().clone());
                            String::new()
                        } else {
                            format!("---\r\nconfig: {config}\r\n---\r\n")
                        };
                        let renderer = Renderer::new().with_engine(
                            Engine::new().with_site_config(MermaidConfig::from_value(site.clone())),
                        );
                        let mut widths = Vec::new();
                        for count in 1..=3 {
                            let label = format!("before {} after", "$$x^2$$".repeat(count));
                            let source = format!(
                                "{prefix}flowchart LR\r\n%% 😀 source\r\nA[\"{label}\"]\r\n"
                            );
                            let result =
                                mermaid_trace_rs::render_with(&renderer, "math-labels", &source)
                                    .unwrap();
                            let svg = result["svg"].as_str().unwrap();
                            let doc = roxmltree::Document::parse(svg).unwrap();
                            let node = doc
                                .descendants()
                                .find(|n| {
                                    n.attribute("data-mt-key") == Some("node:A")
                                        && n.attribute("data-mt-role") == Some("node")
                                })
                                .unwrap();
                            let width: f64 = node
                                .children()
                                .find(|n| n.has_tag_name("rect"))
                                .unwrap()
                                .attribute("width")
                                .unwrap()
                                .parse()
                                .unwrap();
                            let owner = doc
                                .descendants()
                                .find(|n| n.attribute("data-mt-role") == Some("node-label"))
                                .unwrap();
                            let formulas: Vec<_> = owner
                                .descendants()
                                .filter(|n| n.has_tag_name("svg"))
                                .collect();
                            assert_eq!(formulas.len(), count);
                            assert!(
                                formulas
                                    .iter()
                                    .all(|n| n.descendants().any(|p| p.has_tag_name("path")))
                            );
                            assert_eq!(support::text_content(owner), "before  after");
                            let formula_width: f64 =
                                formulas[0].attribute("width").unwrap().parse().unwrap();
                            widths.push(width);
                            assert!(
                                (width - widths[0] - (count - 1) as f64 * formula_width).abs()
                                    < 1e-5,
                                "{layout}/{font_size}/{count}: extra formulas must grow the node by their drawn widths"
                            );
                            let start = source[..source.find(&label).unwrap()]
                                .encode_utf16()
                                .count();
                            assert!(result["mapping"]["pieces"].as_array().unwrap().iter().any(|p| p["labelSpan"]==json!({"start":start,"end":start+label.encode_utf16().count()})));
                            if count == 3 {
                                let painted = support::strip_trace(svg);
                                if let Some(baseline) = &baseline {
                                    assert!(
                                        &painted == baseline,
                                        "legacy browser flags must not change native math geometry"
                                    );
                                } else {
                                    baseline = Some(painted.clone());
                                }
                                let mut plain_site = site.clone();
                                plain_site["traceSource"] = json!(false);
                                let plain_renderer = Renderer::new().with_engine(
                                    Engine::new()
                                        .with_site_config(MermaidConfig::from_value(plain_site)),
                                );
                                let plain = mermaid_trace_rs::render_with(
                                    &plain_renderer,
                                    "math-labels",
                                    &source,
                                )
                                .unwrap();
                                assert!(
                                    painted == support::strip_trace(plain["svg"].as_str().unwrap()),
                                    "mapped/plain parity"
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn plain_rows_in_math_labels_use_the_measured_wrap_width() {
    for layout in ["dagre", "elk"] {
        let source = format!(
            "---\nconfig: {{layout: {layout}, htmlLabels: true, flowchart: {{wrappingWidth: 40}}}}\n---\nflowchart LR\nA[\"$$x$$<br/>alpha beta gamma delta literal $$\"]\n"
        );
        let result = mermaid_trace_rs::render("wrapped-math", &source).unwrap();
        let doc = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let owner = doc
            .descendants()
            .find(|n| n.attribute("data-mt-role") == Some("node-label"))
            .unwrap();
        let rows: Vec<_> = owner
            .descendants()
            .filter(|n| n.has_tag_name("text"))
            .collect();
        assert!(
            rows.len() >= 3,
            "{layout}: plain prose must wrap within 40px"
        );
        assert_eq!(
            rows.iter()
                .filter_map(|n| n.text())
                .collect::<String>()
                .replace(' ', ""),
            "alphabetagammadeltaliteral$$"
        );
        assert!(
            rows.windows(2)
                .all(|pair| pair[0].attribute("y") != pair[1].attribute("y"))
        );
    }
}
