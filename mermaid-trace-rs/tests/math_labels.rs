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
                            let formula_width: f64 = formulas[0]
                                .attribute("width")
                                .unwrap()
                                .strip_suffix("em")
                                .unwrap()
                                .parse::<f64>()
                                .unwrap()
                                * formulas[0]
                                    .attribute("style")
                                    .unwrap()
                                    .rsplit("font-size:")
                                    .next()
                                    .unwrap()
                                    .trim_end_matches("px")
                                    .parse::<f64>()
                                    .unwrap();
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
                .map(|n| support::text_content(*n))
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

#[test]
fn formula_layout_tracks_zero_and_fractional_css_sizes() {
    for layout in ["dagre", "elk"] {
        let mut empty_box = None;
        for size in [0.0, 0.5, 16.0] {
            let source = format!(
                "---\nconfig: {{layout: {layout}, htmlLabels: true}}\n---\nflowchart LR\nA[\"$$x^2$$\"]\nstyle A font-size:{size}px\n"
            );
            let result = mermaid_trace_rs::render("sized-math", &source).unwrap();
            let doc = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let node = doc
                .descendants()
                .find(|n| n.attribute("data-mt-role") == Some("node"))
                .unwrap();
            let rect = node.children().find(|n| n.has_tag_name("rect")).unwrap();
            let label = doc
                .descendants()
                .find(|n| n.attribute("data-mt-role") == Some("node-label"))
                .unwrap();
            let formula = label.descendants().find(|n| n.has_tag_name("svg")).unwrap();
            assert_eq!(
                formula.attribute("style"),
                Some(format!("font-size:{size}px").as_str())
            );
            assert!(
                formula.descendants().any(|n| n.has_tag_name("path")),
                "hidden formulas must retain geometry for CSS reveal"
            );
            let mut dimensions = [0.0; 2];
            for (i, axis) in ["width", "height"].into_iter().enumerate() {
                dimensions[i] = rect.attribute(axis).unwrap().parse::<f64>().unwrap();
                if let Some(base) = empty_box {
                    let em = formula
                        .attribute(axis)
                        .unwrap()
                        .strip_suffix("em")
                        .unwrap()
                        .parse::<f64>()
                        .unwrap();
                    let base: [f64; 2] = base;
                    assert!(
                        (dimensions[i] - base[i] - em * size).abs() < 1e-6,
                        "{layout}/{size}/{axis}: layout must use actual CSS size"
                    );
                }
            }
            if size == 0.0 {
                empty_box = Some(dimensions);
            }
        }
    }
}

#[test]
fn connector_and_subgraph_formula_sizes_preserve_source_and_static_parity() {
    for layout in ["dagre", "elk"] {
        for look in ["classic", "neo", "handDrawn"] {
            for size in [0.0, 0.5, 16.0] {
                for styled in [false, true] {
                    let config = json!({"layout":layout,"look":look,"htmlLabels":true,"handDrawnSeed":42,"themeVariables":{"fontSize":if styled {16.0} else {size}}});
                    let source = format!(
                        "---\r\nconfig: {config}\r\n---\r\nflowchart LR\r\n%% 😀\r\nsubgraph G[\"$$g^2$$\"]\r\nA[One] e@-->|\"$$x^2$$\"| B[Two]\r\nend\r\n{}",
                        if styled {
                            format!(
                                "style G font-size:{size}px\r\nlinkStyle 0 font-size:{size}px\r\n"
                            )
                        } else {
                            String::new()
                        }
                    );
                    let result = mermaid_trace_rs::render("math-owners", &source).unwrap();
                    let svg = result["svg"].as_str().unwrap();
                    let doc = roxmltree::Document::parse(svg).unwrap();
                    for (role, label) in [("edge-label", "$$x^2$$"), ("control-label", "$$g^2$$")] {
                        let owner = doc
                            .descendants()
                            .find(|n| n.attribute("data-mt-role") == Some(role))
                            .unwrap();
                        let formula = owner.descendants().find(|n| n.has_tag_name("svg")).unwrap();
                        assert_eq!(
                            formula.attribute("style"),
                            Some(format!("font-size:{size}px").as_str())
                        );
                        for axis in ["width", "height"] {
                            assert!(
                                formula
                                    .attribute(axis)
                                    .unwrap()
                                    .strip_suffix("em")
                                    .unwrap()
                                    .parse::<f64>()
                                    .unwrap()
                                    > 0.0,
                                "retain formula geometry even at zero CSS size"
                            );
                        }
                        let start = source[..source.find(label).unwrap()].encode_utf16().count();
                        assert_eq!(
                            owner.attribute("data-mt-start"),
                            Some(start.to_string().as_str())
                        );
                        assert_eq!(
                            owner.attribute("data-mt-end"),
                            Some((start + label.len()).to_string().as_str())
                        );
                    }
                    let renderer = Renderer::new().with_engine(Engine::new().with_site_config(MermaidConfig::from_value(json!({"traceSource":false,"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                    let plain =
                        mermaid_trace_rs::render_with(&renderer, "math-owners", &source).unwrap();
                    assert!(
                        support::strip_trace(svg)
                            == support::strip_trace(plain["svg"].as_str().unwrap()),
                        "{layout}/{look}/{size}/{styled}: mapped/plain parity"
                    );
                }
            }
        }
    }
}

#[test]
fn formula_surroundings_preserve_resolved_styles_and_do_not_measure_markup() {
    for layout in ["dagre", "elk"] {
        for role in ["node-label", "edge-label", "control-label"] {
            let mut plain_geometry = None;
            for label in [
                "bold $$x^2$$ tail",
                "<span>bold</span> $$x^2$$ tail",
                "<strong>bold</strong> $$x^2$$ tail",
                "<span style='font-size:32px'>bold $$x^2$$</span> tail",
                "<strong><em>bold</em> $$x^2$$</strong> tail",
                "<span style='font-size:0.5px;color:red'>bold $$x^2$$</span> tail",
                "<span style='font-size:0px'>bold $$x^2$$</span> tail",
            ] {
                let diagram = match role {
                    "node-label" => format!("A[\"{label}\"]"),
                    "edge-label" => format!("A[One] e@-->|\"{label}\"| B[Two]"),
                    _ => format!("subgraph G[\"{label}\"]\nA[One]\nend"),
                };
                let source = format!(
                    "---\r\nconfig: {{layout: {layout}, htmlLabels: true}}\r\n---\r\nflowchart LR\r\n%% 😀\r\n{}\r\n",
                    diagram.replace('\n', "\r\n")
                );
                let result = mermaid_trace_rs::render("styled-math", &source).unwrap();
                let doc = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let owner = doc
                    .descendants()
                    .find(|n| n.attribute("data-mt-role") == Some(role))
                    .unwrap();
                let geometry = doc
                    .descendants()
                    .filter(|n| n.is_element())
                    .flat_map(|n| {
                        n.attributes()
                            .filter(|a| {
                                ["x", "y", "width", "height", "viewBox", "transform", "d"]
                                    .contains(&a.name())
                            })
                            .map(move |a| {
                                (
                                    n.tag_name().name().to_owned(),
                                    a.name().to_owned(),
                                    a.value().to_owned(),
                                )
                            })
                    })
                    .collect::<Vec<_>>();
                if label.starts_with("bold") {
                    plain_geometry = Some(geometry.clone());
                }
                if label.starts_with("<span>") {
                    assert_eq!(
                        Some(&geometry),
                        plain_geometry.as_ref(),
                        "{layout}/{role}: inert HTML must not change label geometry"
                    );
                }
                let bold = owner
                    .descendants()
                    .find(|n| n.is_text() && n.text().is_some_and(|t| t.starts_with("bold")))
                    .unwrap();
                if label.starts_with("<strong>") {
                    assert!(
                        bold.ancestors()
                            .any(|n| n.attribute("font-weight") == Some("bold")
                                || n.attribute("style")
                                    .is_some_and(|s| s.contains("font-weight:bold")
                                        || s.contains("font-weight:700"))),
                        "{layout}/{role}: preserve bold around formulas"
                    );
                }
                let formula = owner.descendants().find(|n| n.has_tag_name("svg")).unwrap();
                let size = if label.contains("32px") {
                    "32px"
                } else if label.contains("0.5px") {
                    "0.5px"
                } else if label.contains("0px") {
                    "0px"
                } else {
                    "16px"
                };
                assert!(
                    formula
                        .attribute("style")
                        .unwrap()
                        .contains(&format!("font-size:{size}")),
                    "{layout}/{role}: formula inherits inline font size"
                );
                if label.contains("<em>") {
                    assert!(bold.ancestors().any(|n| {
                        n.attribute("style")
                            .is_some_and(|s| s.contains("font-style:italic"))
                    }));
                }
                if label.contains("color:red") {
                    assert_eq!(formula.attribute("color"), Some("red"));
                }
                let start = source[..source.find(label).unwrap()].encode_utf16().count();
                assert_eq!(
                    owner.attribute("data-mt-start"),
                    Some(start.to_string().as_str())
                );
                assert_eq!(
                    owner.attribute("data-mt-end"),
                    Some((start + label.encode_utf16().count()).to_string().as_str())
                );
                let plain_renderer = Renderer::new().with_engine(Engine::new().with_site_config(MermaidConfig::from_value(json!({"traceSource":false,"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                let plain =
                    mermaid_trace_rs::render_with(&plain_renderer, "styled-math", &source).unwrap();
                assert!(
                    support::strip_trace(result["svg"].as_str().unwrap())
                        == support::strip_trace(plain["svg"].as_str().unwrap()),
                    "{layout}/{role}: mapped/plain parity"
                );
            }
        }
    }
}

#[test]
fn trusted_css_formula_styles_match_inline_layout_and_export() {
    for layout in ["dagre", "elk"] {
        for size in [0.0, 0.5, 32.0] {
            let mut geometry = None;
            for css in [false, true] {
                let style = format!("font-size:{size}px;font-weight:bold;color:blue");
                let attribute = if css {
                    "class='math-style'".to_owned()
                } else {
                    format!("style='{style}'")
                };
                let source =
                    format!("flowchart LR\nA[\"<span {attribute}>wide $$x^2$$</span> tail\"]\n");
                let config = json!({"traceSource":true,"htmlLabels":true,"layout":layout,"themeCSS":if css {format!(".math-style {{{style}}}")} else {String::new()}});
                let renderer = Renderer::new()
                    .with_engine(Engine::new().with_site_config(MermaidConfig::from_value(config)));
                let result = mermaid_trace_rs::render_with(&renderer, "css-math", &source).unwrap();
                let doc = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let owner = doc
                    .descendants()
                    .find(|n| n.attribute("data-mt-role") == Some("node-label"))
                    .unwrap();
                let formula = owner.descendants().find(|n| n.has_tag_name("svg")).unwrap();
                assert_eq!(
                    formula.attribute("style"),
                    Some(format!("font-size:{size}px").as_str())
                );
                assert_eq!(formula.attribute("color"), Some("blue"));
                let rect = doc
                    .descendants()
                    .find(|n| n.attribute("data-mt-role") == Some("node"))
                    .unwrap()
                    .children()
                    .find(|n| n.has_tag_name("rect"))
                    .unwrap();
                let dimensions: Vec<_> = ["width", "height"]
                    .into_iter()
                    .map(|name| rect.attribute(name).unwrap().to_owned())
                    .collect();
                if css {
                    assert_eq!(
                        Some(dimensions),
                        geometry,
                        "{layout}/{size}: CSS must reach layout"
                    );
                } else {
                    geometry = Some(dimensions);
                }
            }
        }
    }
}

#[test]
fn inline_formula_styles_survive_explicit_rows_and_reset_after_the_owner() {
    for layout in ["dagre", "elk"] {
        for role in ["node-label", "edge-label", "control-label"] {
            for br in ["<br>", "<br/>", "<BR />"] {
                let label = format!(
                    "<span style='font-size:32px'><strong>before $$x^2$${br}<em>after $$y^2$$</em></strong>{br}plain wrapped words alpha beta gamma</span>{br}reset $$z^2$$"
                );
                let diagram = match role {
                    "node-label" => format!("A[\"{label}\"]"),
                    "edge-label" => format!("A[One] e@-->|\"{label}\"| B[Two]"),
                    _ => format!("subgraph G[\"{label}\"]\nA[One]\nend"),
                };
                let source = format!(
                    "---\r\nconfig: {{layout: {layout}, htmlLabels: true, flowchart: {{wrappingWidth: 90}}}}\r\n---\r\nflowchart LR\r\n%% 😀\r\n{}\r\n",
                    diagram.replace('\n', "\r\n")
                );
                let result = mermaid_trace_rs::render("cross-row-math", &source).unwrap();
                let doc = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let owner = doc
                    .descendants()
                    .find(|n| n.attribute("data-mt-role") == Some(role))
                    .unwrap();
                let formulas: Vec<_> = owner
                    .descendants()
                    .filter(|n| n.has_tag_name("svg"))
                    .collect();
                assert_eq!(
                    formulas
                        .iter()
                        .map(|n| n.attribute("style").unwrap())
                        .collect::<Vec<_>>(),
                    ["font-size:32px", "font-size:32px", "font-size:16px"],
                    "{layout}/{role}/{br}: retain inline style until its closing tag"
                );
                assert!(formulas.windows(2).all(|pair| {
                    pair[0].attribute("y").unwrap().parse::<f64>().unwrap()
                        < pair[1].attribute("y").unwrap().parse::<f64>().unwrap()
                }));
                let after = owner
                    .descendants()
                    .find(|n| {
                        n.has_tag_name("tspan") && n.text().is_some_and(|t| t.starts_with("after"))
                    })
                    .unwrap();
                let style = after.attribute("style").unwrap();
                assert!(
                    style.contains("font-size:32px")
                        && style.contains("font-weight:700")
                        && style.contains("font-style:italic")
                );
                let rows: Vec<_> = owner
                    .descendants()
                    .filter(|n| n.has_tag_name("text"))
                    .collect();
                assert!(rows.len() >= 4, "{layout}/{role}: preserve explicit rows");
                // Plain subgraph titles have no soft-wrap limit; node and edge labels do.
                if role != "control-label" {
                    assert!(
                        rows.len() > 4,
                        "{layout}/{role}: plain rows must still wrap"
                    );
                }
                let start = source[..source.find(&label).unwrap()]
                    .encode_utf16()
                    .count();
                assert_eq!(
                    owner.attribute("data-mt-start"),
                    Some(start.to_string().as_str())
                );
                assert_eq!(
                    owner.attribute("data-mt-end"),
                    Some((start + label.encode_utf16().count()).to_string().as_str())
                );
                let plain_renderer = Renderer::new().with_engine(Engine::new().with_site_config(MermaidConfig::from_value(json!({"traceSource":false,"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                let plain =
                    mermaid_trace_rs::render_with(&plain_renderer, "cross-row-math", &source)
                        .unwrap();
                assert!(
                    support::strip_trace(result["svg"].as_str().unwrap())
                        == support::strip_trace(plain["svg"].as_str().unwrap())
                );
            }
        }
    }
}
