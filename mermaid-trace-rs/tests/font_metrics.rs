mod support;
use merman::svg::{TextMeasurementSource, TextStyle};
use merman::{
    Engine, MermaidConfig, OperationControl, RenderOutput, RenderRequest, Renderer, SvgOutput,
    SvgRequest,
};
use merman_export::text::NativeFontContext;
use serde_json::json;
use std::sync::Arc;

fn render(
    fonts: &Arc<NativeFontContext>,
    source: &str,
    family: &str,
    traced: bool,
    html: bool,
) -> SvgOutput {
    let renderer = Renderer::new().with_engine(Engine::new().with_site_config(
        MermaidConfig::from_value(json!({
            "traceSource": traced, "fontFamily": family, "fontSize": 16,
            "htmlLabels": html, "look": "neo", "deterministicIds": true,
            "deterministicIDSeed": "font-test"
        })),
    ));
    let mut request = SvgRequest::default();
    request.options.diagram_id = Some("font-test".into());
    request.pipeline = Some(merman::svg::SvgPipeline::resvg_safe());
    request.environment = request
        .environment
        .with_text_measurement_policy(Arc::clone(fonts).measurement_policy());
    let RenderOutput::Svg(Some(output)) = renderer
        .render(RenderRequest::svg(source, OperationControl::new(), request))
        .unwrap()
    else {
        panic!("expected SVG");
    };
    let report = output.evidence().measurement();
    assert!(!report.entries().is_empty());
    assert!(
        report
            .entries()
            .iter()
            .all(
                |entry| entry.provenance().source == TextMeasurementSource::Host
                    && entry.provenance().fallback_reason.is_none()
            ),
        "font accuracy cannot silently fall back: {source} {report:?}"
    );
    if !traced {
        let document = roxmltree::Document::parse(output.svg()).unwrap();
        let metadata = document
            .descendants()
            .find_map(|node| node.attribute("data-mt-native"))
            .unwrap_or("[]");
        assert!(
            serde_json::from_str::<Vec<serde_json::Value>>(metadata)
                .unwrap()
                .is_empty(),
            "plain reference must not capture source occurrences"
        );
    }
    output
}

#[test]
fn native_font_metrics_reach_node_geometry_in_both_layouts() {
    let fonts = Arc::new(NativeFontContext::system().unwrap());
    let text = "WWiiiiMMMM";
    for html in [false, true] {
        for header in ["flowchart", "flowchart-elk"] {
            let source = format!("{header} LR\nA[\"{text}\"]");
            let mut widths = Vec::new();
            let mut expected = Vec::new();
            for family in ["Arial", "monospace"] {
                let output = render(&fonts, &source, family, true, html);
                let document = roxmltree::Document::parse(output.svg()).unwrap();
                let node = document
                    .descendants()
                    .find(|n| n.attribute("data-mt-key") == Some("node:A"))
                    .unwrap();
                let rect = node.descendants().find(|n| n.has_tag_name("rect")).unwrap();
                widths.push(rect.attribute("width").unwrap().parse::<f64>().unwrap());
                let label = fonts
                    .shape(
                        text,
                        &TextStyle {
                            font_family: Some(family.into()),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                let logical = label.bounds.unwrap();
                let ink = label.ink_bounds.unwrap();
                expected.push(logical.right.max(ink.right) - logical.left.min(ink.left));
                assert_eq!(
                    support::strip_trace(output.svg()),
                    support::strip_trace(render(&fonts, &source, family, false, html).svg()),
                    "font measurement must preserve mapped/plain parity"
                );
            }
            assert!(
                (expected[0] - expected[1]).abs() > 1.0,
                "the geometry regression needs two distinct font widths"
            );
            assert!(
                ((widths[0] - widths[1]) - (expected[0] - expected[1])).abs() < 0.01,
                "{header}: node widths {widths:?}, font widths {expected:?}"
            );
        }
    }
}

#[test]
fn explicit_default_theme_font_wins_over_legacy_root_font() {
    let theme_font = r#""trebuchet ms", verdana, arial, sans-serif"#;
    let body = "flowchart LR\r\nsubgraph G[Group WWWiii]\r\nA[Alpha WWWiii] e@-->|Next WWWiii| B[Beta]\r\nend";
    for layout in ["dagre", "elk"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for layer in ["site", "directive", "frontmatter"] {
                    let draw = |root_font: &str, explicit_theme: Option<&str>| {
                        let mut config = json!({"layout": layout, "look": look, "handDrawnSeed": 42, "htmlLabels": html,
                        "fontFamily": root_font});
                        if let Some(font) = explicit_theme {
                            config["themeVariables"] = json!({"fontFamily": font});
                        }
                        let source = match layer {
                            "site" => body.to_owned(),
                            "frontmatter" => {
                                format!("---\r\nconfig: {config}\r\n---\r\n%% 😀\r\n{body}")
                            }
                            _ => format!("%% 😀\r\n%%{{init: {config}}}%%\r\n{body}"),
                        };
                        let renderer = if layer == "site" {
                            let mut config = config;
                            config["traceSource"] = json!(true);
                            Renderer::new().with_engine(
                                Engine::new().with_site_config(MermaidConfig::from_value(config)),
                            )
                        } else {
                            mermaid_trace_rs::renderer()
                        };
                        let output =
                            mermaid_trace_rs::render_with(&renderer, "font-precedence", &source)
                                .unwrap();
                        assert_eq!(output["mapping"]["source"], source);
                        let svg = output["svg"].as_str().unwrap();
                        let doc = roxmltree::Document::parse(svg).unwrap();
                        // Compare rendered object geometry and text/font attributes, not configuration metadata.
                        let utf16: Vec<_> = source.encode_utf16().collect();
                        for (role, label) in [
                            ("node-label", "Alpha WWWiii"),
                            ("edge-label", "Next WWWiii"),
                            ("control-label", "Group WWWiii"),
                        ] {
                            let target = doc
                                .descendants()
                                .find(|n| n.attribute("data-mt-role") == Some(role))
                                .unwrap();
                            let start: usize =
                                target.attribute("data-mt-start").unwrap().parse().unwrap();
                            let end: usize =
                                target.attribute("data-mt-end").unwrap().parse().unwrap();
                            assert_eq!(String::from_utf16(&utf16[start..end]).unwrap(), label);
                        }
                        ["node:A", "edge:e", "flowchart:subgraph:G"].map(|key| {
                            doc.descendants()
                                .filter(|n| n.attribute("data-mt-key") == Some(key))
                                .map(|object| support::strip_trace(&svg[object.range()]))
                                .collect::<Vec<_>>()
                        })
                    };
                    assert_eq!(
                        draw("Arial", Some(theme_font)),
                        draw(theme_font, Some(theme_font)),
                        "{layout}/{look}, html={html}, layer={layer}: explicit theme font must win even when it equals the default"
                    );
                    assert_eq!(
                        draw("Arial", None),
                        draw("Arial", Some("Arial")),
                        "root-only font must still be normalized"
                    );
                }
            }
        }
    }
}

#[test]
fn alternate_font_configuration_does_not_override_flowchart_fonts_or_ownership() {
    let body = "flowchart LR\r\n%% 😀\r\nsubgraph G[Group WWWiii]\r\nA[Alpha WWWiii] e@-->|Next WWWiii| B[Beta]\r\nend";
    for layout in ["dagre", "elk"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for layer in ["site", "directive", "frontmatter"] {
                    let mut baseline = None;
                    for font in [None, Some(""), Some("Courier New"), Some("Arial")] {
                        let mut config = json!({"layout":layout,"look":look,"handDrawnSeed":42,"htmlLabels":html,"fontFamily":"Arial"});
                        if let Some(font) = font {
                            config["altFontFamily"] = json!(font);
                        }
                        let source = match layer {
                            "site" => body.to_owned(),
                            "directive" => format!("%%{{init: {config}}}%%\r\n{body}"),
                            _ => format!("---\r\nconfig: {config}\r\n---\r\n{body}"),
                        };
                        let draw = |traced| {
                            let mut site = if layer == "site" {
                                config.clone()
                            } else {
                                json!({})
                            };
                            site["traceSource"] = json!(traced);
                            site["deterministicIds"] = json!(true);
                            site["deterministicIDSeed"] = json!("mermaid-trace");
                            let renderer = Renderer::new().with_engine(
                                Engine::new().with_site_config(MermaidConfig::from_value(site)),
                            );
                            mermaid_trace_rs::render_with(&renderer, "alt-font", &source).unwrap()
                        };
                        let result = draw(true);
                        let svg = result["svg"].as_str().unwrap();
                        let doc = roxmltree::Document::parse(svg).unwrap();
                        let units: Vec<_> = source.encode_utf16().collect();
                        for (role, text) in [
                            ("node-label", "Alpha WWWiii"),
                            ("edge-label", "Next WWWiii"),
                            ("control-label", "Group WWWiii"),
                        ] {
                            let label = doc
                                .descendants()
                                .find(|n| n.attribute("data-mt-role") == Some(role))
                                .unwrap();
                            let start: usize =
                                label.attribute("data-mt-start").unwrap().parse().unwrap();
                            let end: usize =
                                label.attribute("data-mt-end").unwrap().parse().unwrap();
                            assert_eq!(String::from_utf16(&units[start..end]).unwrap(), text);
                        }
                        let painted = support::strip_trace(svg);
                        assert_eq!(
                            painted,
                            support::strip_trace(draw(false)["svg"].as_str().unwrap())
                        );
                        if let Some(expected) = &baseline {
                            assert_eq!(
                                &painted, expected,
                                "{layout}/{look}/{html}/{layer}/{font:?}"
                            );
                        } else {
                            baseline = Some(painted);
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn fractional_pixel_font_sizes_survive_production_export() {
    for layout in ["dagre", "elk"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for size in [16.25, 24.5] {
                    let config = json!({"layout": layout, "look": look, "handDrawnSeed": 42,
                        "htmlLabels": html, "fontFamily": "Arial",
                        "themeVariables": {"fontSize": format!("{size}px")}});
                    let source = format!(
                        "%% 😀\r\n%%{{init: {config}}}%%\r\nflowchart LR\r\nA[Alpha WWWiii] e@-->|Next WWWiii| B[Beta]"
                    );
                    let output = mermaid_trace_rs::render("fractional-font", &source).unwrap();
                    let svg = output["svg"].as_str().unwrap();
                    let doc = roxmltree::Document::parse(svg).unwrap();
                    assert!(
                        doc.descendants()
                            .filter(|n| n.has_tag_name("style"))
                            .any(|n| support::text_content(n)
                                .contains(&format!("font-size:{size}px"))),
                        "{layout}/{look}/html={html}: authored fractional font size was lost"
                    );
                    assert_eq!(output["mapping"]["source"], source);
                    let utf16: Vec<_> = source.encode_utf16().collect();
                    for (role, label) in [
                        ("node-label", "Alpha WWWiii"),
                        ("edge-label", "Next WWWiii"),
                    ] {
                        let target = doc
                            .descendants()
                            .find(|n| n.attribute("data-mt-role") == Some(role))
                            .unwrap();
                        let start: usize =
                            target.attribute("data-mt-start").unwrap().parse().unwrap();
                        let end: usize = target.attribute("data-mt-end").unwrap().parse().unwrap();
                        assert_eq!(String::from_utf16(&utf16[start..end]).unwrap(), label);
                    }
                }
            }
        }
    }
}

#[test]
fn absolute_font_units_match_equivalent_pixel_geometry() {
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            for styled in [false, true] {
                let draw = |size: &str| {
                    let mut config =
                        json!({"layout": layout, "htmlLabels": html, "fontFamily": "Arial"});
                    if !styled {
                        config["themeVariables"] = json!({"fontSize": size});
                    }
                    let source = format!(
                        "%% 😀\r\n%%{{init: {config}}}%%\r\nflowchart LR\r\nA[Alpha WWWiii] --> B[Beta]\r\n{}",
                        if styled {
                            format!("style A font-size:{size}")
                        } else {
                            String::new()
                        }
                    );
                    let output = mermaid_trace_rs::render("absolute-font", &source).unwrap();
                    let doc = roxmltree::Document::parse(output["svg"].as_str().unwrap()).unwrap();
                    let owner = doc
                        .descendants()
                        .find(|n| {
                            n.attribute("data-mt-key") == Some("node:A")
                                && n.attribute("data-mt-role") == Some("node")
                        })
                        .unwrap();
                    let rect = owner.children().find(|n| n.has_tag_name("rect")).unwrap();
                    let label = doc
                        .descendants()
                        .find(|n| {
                            n.attribute("data-mt-key") == Some("node:A")
                                && n.attribute("data-mt-role") == Some("node-label")
                        })
                        .unwrap();
                    if styled && html {
                        let text = label
                            .descendants()
                            .find(|n| n.has_tag_name("text"))
                            .unwrap();
                        let style = text.attribute("style").unwrap();
                        let pixels: f64 = style
                            .split(';')
                            .find_map(|decl| decl.strip_prefix("font-size:"))
                            .unwrap()
                            .trim_end_matches("px")
                            .parse()
                            .unwrap();
                        assert!((pixels - 24.0).abs() < 1e-6, "exported {size}: {pixels}");
                    }
                    let start: usize = label.attribute("data-mt-start").unwrap().parse().unwrap();
                    let end: usize = label.attribute("data-mt-end").unwrap().parse().unwrap();
                    assert_eq!(
                        String::from_utf16(&source.encode_utf16().collect::<Vec<_>>()[start..end])
                            .unwrap(),
                        "Alpha WWWiii"
                    );
                    ["width", "height"]
                        .map(|name| rect.attribute(name).unwrap().parse::<f64>().unwrap())
                };
                let expected = draw("24px");
                for size in [
                    "18pt", "1.5pc", "0.25in", "0.635cm", "6.35mm", "25.4Q", "18PT",
                ] {
                    let actual = draw(size);
                    for (actual, expected) in actual.into_iter().zip(expected) {
                        assert!(
                            (actual - expected).abs() < 1e-6,
                            "{layout}/html={html}/styled={styled}/{size}: {actual} != {expected}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn numeric_theme_fonts_match_pixel_strings_in_production() {
    for layout in ["dagre", "elk"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                for size in [0.0, 0.5, 24.0, 24.5] {
                    for authored in ["", "1.5em", "1.5rem", "150%"] {
                        let draw = |font_size: serde_json::Value| {
                            let config = json!({"layout": layout, "look": look, "htmlLabels": html,
                                "handDrawnSeed": 42, "themeVariables": {"fontSize": font_size}});
                            let styles = if authored.is_empty() {
                                String::new()
                            } else {
                                format!(
                                    "\nstyle A font-size:{authored}\nstyle G font-size:{authored}\nlinkStyle 0 font-size:{authored}"
                                )
                            };
                            let source = format!(
                                "%%{{init: {config}}}%%\nflowchart LR\nsubgraph G[Group]\nA[Alpha] -->|Next| B[Beta]\nend{styles}"
                            );
                            let output = mermaid_trace_rs::render("numeric-font", &source).unwrap();
                            let svg = output["svg"].as_str().unwrap();
                            let doc = roxmltree::Document::parse(svg).unwrap();
                            for (role, text) in [
                                ("node-label", "Alpha"),
                                ("edge-label", "Next"),
                                ("control-label", "Group"),
                            ] {
                                let target = doc
                                    .descendants()
                                    .find(|n| n.attribute("data-mt-role") == Some(role))
                                    .unwrap();
                                let start: usize =
                                    target.attribute("data-mt-start").unwrap().parse().unwrap();
                                let end: usize =
                                    target.attribute("data-mt-end").unwrap().parse().unwrap();
                                assert_eq!(&source[start..end], text);
                            }
                            assert_eq!(output["mapping"]["source"], source);
                            support::strip_trace(svg)
                        };
                        assert!(
                            draw(json!(size)) == draw(json!(format!("{size}px"))),
                            "{layout}/{look}/{html}/{size}/{authored}: numeric font differs from pixel string"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn authored_font_styles_resolve_once_for_owned_labels() {
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            for base in [16.0, 20.5, 0.5, 0.0] {
                for cascade in ["inline", "class", "override"] {
                    let draw = |value: &str, expected_size: f64| {
                        let config = json!({"layout": layout, "htmlLabels": html,
                            "themeVariables": {"fontSize": format!("{base}px")}});
                        let prior = if cascade == "override" {
                            "classDef first font-size:2em\nlinkStyle default font-size:3em\n"
                        } else {
                            ""
                        };
                        let styles = if cascade == "class" {
                            format!("classDef last font-size:{value}\nclass A,G,e last")
                        } else {
                            format!(
                                "style A font-size:{value}\nstyle G font-size:{value}\nlinkStyle 0 font-size:{value}"
                            )
                        };
                        // Bind the class after styles create the subgraph's rendered CSS owner.
                        let binding = if cascade == "override" {
                            "\nclass A,G,e first"
                        } else {
                            ""
                        };
                        let source = format!(
                            "%%{{init: {config}}}%%\nflowchart LR\nsubgraph G[Group]\nA[Alpha] e@-->|Next| B[Beta]\nend\n{prior}{styles}{binding}"
                        );
                        let output = mermaid_trace_rs::render("relative-style", &source).unwrap();
                        let doc =
                            roxmltree::Document::parse(output["svg"].as_str().unwrap()).unwrap();
                        let mut bounds = Vec::new();
                        for (key, role, label_text) in [
                            ("node:A", "node-label", "Alpha"),
                            ("edge:e", "edge-label", "Next"),
                            ("flowchart:subgraph:G", "control-label", "Group"),
                        ] {
                            let label = doc
                                .descendants()
                                .find(|n| {
                                    n.attribute("data-mt-key") == Some(key)
                                        && n.attribute("data-mt-role") == Some(role)
                                })
                                .unwrap();
                            let start: usize =
                                label.attribute("data-mt-start").unwrap().parse().unwrap();
                            let end: usize =
                                label.attribute("data-mt-end").unwrap().parse().unwrap();
                            assert_eq!(&source[start..end], label_text);
                            if html {
                                let text = label
                                    .descendants()
                                    .find(|n| n.has_tag_name("text"))
                                    .unwrap();
                                let size = text
                                    .attribute("style")
                                    .unwrap()
                                    .split(';')
                                    .find_map(|decl| decl.strip_prefix("font-size:"))
                                    .unwrap()
                                    .trim_end_matches("px")
                                    .parse::<f64>()
                                    .unwrap();
                                assert!(
                                    (size - expected_size).abs() < 1e-6,
                                    "{layout}/{html}/{base}/{cascade}/{value}/{role}: exported {size}px"
                                );
                            }
                        }
                        for key in ["node:A", "flowchart:subgraph:G"] {
                            let owner = doc
                                .descendants()
                                .find(|n| {
                                    n.attribute("data-mt-key") == Some(key)
                                        && !n.has_attribute("data-mt-label")
                                })
                                .unwrap();
                            let shape = owner.children().find(|n| n.has_tag_name("rect")).unwrap();
                            for attr in ["width", "height"] {
                                bounds.push(shape.attribute(attr).unwrap().parse::<f64>().unwrap());
                            }
                        }
                        bounds
                    };
                    for (value, pixels) in [
                        ("1.5em", base * 1.5),
                        ("150%", base * 1.5),
                        ("1.5rem", base * 1.5),
                        ("xx-small", 9.0),
                        ("x-small", 10.0),
                        ("small", 13.0),
                        ("medium", 16.0),
                        ("large", 18.0),
                        ("x-large", 24.0),
                        ("xx-large", 32.0),
                        ("xxx-large", 48.0),
                        ("initial", 16.0),
                        ("inherit", base),
                        ("unset", base),
                        ("revert", base),
                        (
                            "revert-layer",
                            if cascade == "override" {
                                base * 2.0
                            } else {
                                base
                            },
                        ),
                        ("smaller", base / 1.2),
                        ("larger", base * 1.2),
                    ] {
                        let expected = draw(&format!("{pixels}px"), pixels);
                        let actual = draw(value, pixels);
                        for (actual, expected) in actual.into_iter().zip(&expected) {
                            assert!(
                                (actual - expected).abs() < 1e-6,
                                "{layout}/{html}/{base}/{cascade}/{value}: {actual} != {expected}"
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn relative_theme_fonts_match_pixel_geometry_and_source() {
    for layout in ["dagre", "elk"] {
        for look in ["classic", "neo", "handDrawn"] {
            for html in [false, true] {
                let draw = |size: &str| {
                    let config = json!({"layout": layout, "look": look, "htmlLabels": html,
                        "handDrawnSeed": 42, "themeVariables": {"fontSize": size}});
                    let source = format!(
                        "%%{{init: {config}}}%%\nflowchart LR\nA[Alpha WWWiii] -->|Next| B[Beta]"
                    );
                    let output = mermaid_trace_rs::render("relative-font", &source).unwrap();
                    let svg = output["svg"].as_str().unwrap();
                    let document = roxmltree::Document::parse(svg).unwrap();
                    for (role, expected) in [("node-label", "Alpha WWWiii"), ("edge-label", "Next")]
                    {
                        let label = document
                            .descendants()
                            .find(|n| n.attribute("data-mt-role") == Some(role))
                            .unwrap();
                        let start: usize =
                            label.attribute("data-mt-start").unwrap().parse().unwrap();
                        let end: usize = label.attribute("data-mt-end").unwrap().parse().unwrap();
                        assert_eq!(&source[start..end], expected);
                    }
                    assert_eq!(output["mapping"]["source"], source);
                    // The complete painted artifact must equal the pixel control, apart from source metadata.
                    support::strip_trace(svg)
                };
                for (pixel, relatives) in [
                    ("24px", ["1.5em", "1.5rem", "150%"]),
                    ("8px", ["0.5em", "0.5rem", "50%"]),
                    ("0px", ["0em", "0rem", "0%"]),
                ] {
                    let expected = draw(pixel);
                    for relative in relatives {
                        assert_eq!(
                            draw(relative),
                            expected,
                            "{layout}/{look}/{html}/{relative}"
                        );
                    }
                }
                for (keyword, pixels) in [
                    ("xx-small", 9.0),
                    ("x-small", 10.0),
                    ("small", 13.0),
                    ("medium", 16.0),
                    ("large", 18.0),
                    ("x-large", 24.0),
                    ("xx-large", 32.0),
                    ("xxx-large", 48.0),
                    ("initial", 16.0),
                    ("inherit", 16.0),
                    ("unset", 16.0),
                    ("revert", 16.0),
                    ("revert-layer", 16.0),
                    ("smaller", 16.0 / 1.2),
                    ("larger", 16.0 * 1.2),
                ] {
                    assert!(
                        draw(keyword) == draw(&format!("{pixels}px")),
                        "{layout}/{look}/{html}/{keyword}: differs from pixel control"
                    );
                }
            }
        }
    }
}

#[test]
fn zero_font_configuration_preserves_unpainted_source_text() {
    for layout in ["dagre", "elk"] {
        for look in ["classic", "neo", "handDrawn"] {
            for styled in [false, true] {
                for html in [false, true] {
                    for size in [json!(0), json!("0px"), json!("0pt")] {
                        let config = json!({
                            "layout": layout, "htmlLabels": html, "look": look,
                            "themeVariables": {"fontSize": if styled { json!(16) } else { size.clone() }}
                        });
                        let mut source =
                            format!("%%{{init: {config}}}%%\nflowchart LR\nA[Alpha] --> B[Beta]");
                        if styled {
                            source.push_str(&format!(
                                "\nstyle A font-size:{}",
                                size.as_str()
                                    .map(str::to_owned)
                                    .unwrap_or_else(|| size.to_string())
                            ));
                        }
                        let output = mermaid_trace_rs::render("zero-font", &source).unwrap();
                        let svg = output["svg"].as_str().unwrap();
                        assert!(
                            svg.replace("font-size: ", "font-size:")
                                .contains(if styled {
                                    "font-size:0"
                                } else {
                                    "font-size:0px"
                                }),
                            "{layout}/{html}/{size}: zero size was coerced"
                        );
                        let doc = roxmltree::Document::parse(svg).unwrap();
                        let label = doc
                            .descendants()
                            .find(|n| {
                                n.attribute("data-mt-key") == Some("node:A")
                                    && n.attribute("data-mt-role") == Some("node-label")
                            })
                            .unwrap_or_else(|| {
                                panic!(
                                    "{layout}/{html}/{size}: hidden label keeps its source identity"
                                )
                            });
                        assert!(
                            label.descendants().any(|n| n.has_tag_name("text")),
                            "hidden text must remain editable by CSS"
                        );
                        assert_eq!(support::text_content(label), "Alpha");
                        let start: usize =
                            label.attribute("data-mt-start").unwrap().parse().unwrap();
                        let end: usize = label.attribute("data-mt-end").unwrap().parse().unwrap();
                        assert_eq!(&source[start..end], "Alpha");
                        assert!(
                            svg.contains("@font-face"),
                            "hidden text retains portable fonts"
                        );
                        assert_eq!(output["mapping"]["source"], source);
                    }
                }
            }
        }
    }
}

#[test]
fn existing_family_font_requests_have_no_silent_approximate_fallback() {
    let fonts = Arc::new(NativeFontContext::system().unwrap());
    for html in [false, true] {
        for source in [
            "flowchart LR\nA[\"`Alpha **bold** beta gamma delta epsilon 😀`\"] -->|next| B[Beta]",
            "sequenceDiagram\nparticipant A as Alpha 😀\nA->>B: Hello world\nNote right of A: Review",
            "gantt\ndateFormat YYYY-MM-DD\nsection Build\nAlpha 😀 :a, 2026-10-01, 2d",
            "journey\ntitle Build\nsection Work\nAlpha 😀: 5: Alice, Bob",
            "kanban\n  todo[Todo]\n    task[Alpha 😀]",
            "stateDiagram-v2\nstate \"Alpha 😀\" as A\nA --> B: next\nnote right of B: Review",
        ] {
            let output = render(&fonts, source, "Arial, sans-serif", true, html);
            assert!(
                output.svg().contains("data-mt-native"),
                "source ownership metadata must survive: {source}"
            );
            assert_eq!(
                support::strip_trace(output.svg()),
                support::strip_trace(
                    render(&fonts, source, "Arial, sans-serif", false, html).svg()
                )
            );
        }
    }
}

#[test]
fn measured_existing_family_labels_outline_without_losing_native_ownership() {
    let fonts = Arc::new(NativeFontContext::system().unwrap());
    for html in [false, true] {
        for source in [
            "flowchart LR\nA[\"`Alpha **bold** beta 😀`\"] -->|next| B[Beta]",
            "flowchart-elk LR\nA[\"`Alpha **bold** beta 😀`\"] -->|next| B[Beta]",
            "sequenceDiagram\nparticipant A as Alpha 😀\nA->>B: Hello world\nNote right of A: Review",
            "gantt\ndateFormat YYYY-MM-DD\nsection Build\nAlpha 😀 :a, 2026-10-01, 2d",
            "journey\ntitle Build\nsection Work\nAlpha 😀: 5: Alice, Bob",
            "kanban\n  todo[Todo]\n    task[Alpha 😀]",
            "stateDiagram-v2\nstate \"Alpha 😀\" as A: Repeated\nA : Repeated\nA --> B: next\nnote right of B: Review",
        ] {
            let output = render(&fonts, source, "Arial, sans-serif", true, html);
            let session = merman_render::environment::RenderEnvironment::deterministic()
                .begin_session()
                .unwrap();
            let pipeline = merman::svg::SvgPipeline::resvg_safe();
            let sealed = pipeline
                .process_resvg_compatible(output.svg(), &session)
                .unwrap();
            let glyphs = fonts
                .outline_svg(&sealed)
                .unwrap_or_else(|e| panic!("{source}: {e}"));
            let final_svg = pipeline
                .process_resvg_compatible(&glyphs, &session)
                .unwrap();
            let plain = render(&fonts, source, "Arial, sans-serif", false, html);
            let plain_sealed = pipeline
                .process_resvg_compatible(plain.svg(), &session)
                .unwrap();
            let plain_glyphs = fonts.outline_svg(&plain_sealed).unwrap();
            let plain_final = pipeline
                .process_resvg_compatible(&plain_glyphs, &session)
                .unwrap();
            assert_eq!(
                support::strip_trace(final_svg.as_str()),
                support::strip_trace(plain_final.as_str()),
                "outlining must preserve mapped/plain parity: {source}"
            );
            let before = roxmltree::Document::parse(output.svg()).unwrap();
            let after = roxmltree::Document::parse(final_svg.as_str()).unwrap();
            let identities = |document: &roxmltree::Document<'_>| {
                document
                    .descendants()
                    .filter_map(|node| {
                        node.attribute("data-mt-key").map(|key| {
                            (
                                key.to_owned(),
                                node.attribute("data-mt-label").map(str::to_owned),
                            )
                        })
                    })
                    .collect::<Vec<_>>()
            };
            assert_eq!(
                identities(&before),
                identities(&after),
                "every native identity must survive: {source}"
            );
            assert_eq!(
                before
                    .descendants()
                    .find_map(|n| n.attribute("data-mt-native")),
                after
                    .descendants()
                    .find_map(|n| n.attribute("data-mt-native"))
            );
            assert!(
                !after.descendants().any(|node| node.has_tag_name("text")),
                "font-dependent text remains: {source}"
            );
            assert!(
                after.descendants().any(|node| node.has_tag_name("use")),
                "no outlined labels: {source}"
            );
        }
    }
}

#[test]
#[cfg(target_os = "macos")]
fn portable_font_fallback_reports_authored_aat_choice_without_changing_source() {
    let source = "---\nconfig: {fontFamily: Apple Color Emoji}\n---\nflowchart LR\nA[\"🧑‍💻 ABC\"]";
    let result = mermaid_trace_rs::render("portable-fallback", source).unwrap();
    assert_eq!(result["source"], source);
    assert_eq!(result["mapping"]["source"], source);
    let diagnostics = result["diagnostics"].as_array().unwrap();
    let fallback = diagnostics
        .iter()
        .find(|d| d["code"] == "font-fallback")
        .expect("an authored nonportable font must report its substitution");
    assert_eq!(fallback["font"], "AppleColorEmoji");
    assert!(!fallback["replacement"].as_str().unwrap().is_empty());
    assert_ne!(fallback["replacement"], fallback["font"]);
    let ordinary = mermaid_trace_rs::render("ordinary-font", "flowchart LR\nA[Hello]").unwrap();
    assert!(ordinary["diagnostics"].as_array().unwrap().is_empty());
}

#[test]
fn production_existing_families_embed_fonts_with_source_ownership() {
    for source in [
        "flowchart LR\nA[Alpha] -->|next| B[Beta]",
        "flowchart-elk LR\nA[Alpha] -->|next| B[Beta]",
        "sequenceDiagram\nparticipant A as Alpha\nA->>B: Hello\nNote right of A: Review",
        "gantt\ndateFormat YYYY-MM-DD\nsection Build\nAlpha :a, 2026-10-01, 2d",
        "journey\ntitle Build\nsection Work\nAlpha: 5: Alice, Bob",
        "kanban\n  todo[Todo]\n    task[Alpha]",
        "stateDiagram-v2\nstate \"Alpha\" as A: Repeated\nA : Repeated\nA --> B: next\nnote right of B: Review",
    ] {
        let result = mermaid_trace_rs::render("production-fonts", source).unwrap();
        let svg = result["svg"].as_str().unwrap();
        let document = roxmltree::Document::parse(svg).unwrap();
        assert!(
            svg.contains("@font-face") && svg.contains("src:url(data:font/"),
            "production output lacks embedded fonts: {source}"
        );
        let labels: Vec<_> = document
            .descendants()
            .filter(|n| {
                n.has_attribute("data-mt-role") && n.descendants().any(|c| c.has_tag_name("text"))
            })
            .collect();
        assert!(
            !labels.is_empty(),
            "portable labels lost source ownership: {source}"
        );
        for label in labels {
            assert!(label.has_attribute("data-mt-start"));
            assert!(label.has_attribute("data-mt-end"));
        }
    }
}

#[test]
fn missing_characters_preserve_existing_family_source_and_emit_diagnostics() {
    let label = "Before \u{10ffff} and \u{10fffe} after";
    for source in [
        format!("flowchart LR\nA[\"{label}\"]"),
        format!("flowchart-elk LR\nA[\"{label}\"]"),
        format!("sequenceDiagram\nA->>B: {label}"),
        format!("gantt\ndateFormat YYYY-MM-DD\n{label} :a, 2026-10-01, 2d"),
        format!("journey\nsection Work\n{label}: 5: Alice"),
        format!("kanban\n  todo[Todo]\n    task[{label}]"),
        format!("stateDiagram-v2\nstate \"{label}\" as A"),
    ] {
        let result = mermaid_trace_rs::render("missing-characters", &source).unwrap();
        assert_eq!(result["source"], source);
        assert_eq!(result["mapping"]["source"], source);
        let diagnostics = result["diagnostics"].as_array().unwrap();
        assert_eq!(diagnostics.len(), 2, "{source}");
        for (diagnostic, character) in diagnostics.iter().zip(['\u{10fffe}', '\u{10ffff}']) {
            assert_eq!(diagnostic["code"], "missing-character");
            assert_eq!(diagnostic["character"], character.to_string());
            assert_eq!(diagnostic["replacement"], "\u{fffd}");
        }
        let document = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        // Gantt owns the authored space before its task metadata separator.
        let authored_label = if source.starts_with("gantt") {
            format!("{label} ")
        } else {
            label.to_owned()
        };
        let text = document
            .descendants()
            .find(|n| {
                n.has_tag_name("text") && n.attribute("aria-label") == Some(authored_label.as_str())
            })
            .unwrap_or_else(|| panic!("missing accessible original text: {source}"));
        assert_eq!(
            support::text_content(text),
            label.replace(['\u{10ffff}', '\u{10fffe}'], "\u{fffd}")
        );
        let target = text
            .ancestors()
            .find(|n| n.has_attribute("data-mt-start"))
            .unwrap();
        let start: usize = target.attribute("data-mt-start").unwrap().parse().unwrap();
        let end: usize = target.attribute("data-mt-end").unwrap().parse().unwrap();
        let selected =
            String::from_utf16(&source.encode_utf16().collect::<Vec<_>>()[start..end]).unwrap();
        assert!(selected.contains(label), "source range changed: {selected}");
        assert!(target.descendants().any(|n| n.has_tag_name("text")));
    }
}

#[test]
fn trusted_css_rich_label_runs_reach_layout_and_export() {
    for layout in ["dagre", "elk"] {
        let draw = |inline: bool, size: u32| {
            let style = if inline {
                format!(" style='font-size:{size}px'")
            } else {
                String::new()
            };
            let source =
                format!("flowchart LR\nA[\"<span class='large'{style}>Wide</span> small\"]\n");
            let renderer = Renderer::new().with_engine(Engine::new().with_site_config(
                MermaidConfig::from_value(json!({"traceSource":true, "htmlLabels":true,
                    "layout":layout, "fontFamily":"Arial", "themeCSS":if inline { String::new() } else { format!(".nodeLabel .large{{font-size:{size}px}}") }})),
            ));
            mermaid_trace_rs::render_with(&renderer, "rich-css", &source).unwrap()
        };
        let expected = draw(true, 32);
        let actual = draw(false, 32);
        if let Ok(directory) = std::env::var("TRACE_CSS_LAYER_ARTIFACTS") {
            std::fs::write(
                std::path::Path::new(&directory).join(format!("rich-{layout}.json")),
                serde_json::to_vec(&actual).unwrap(),
            )
            .unwrap();
        }
        let small = draw(true, 16);
        let dimensions = |result: &serde_json::Value| {
            let doc = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let owner = doc
                .descendants()
                .find(|n| n.attribute("data-mt-role") == Some("node"))
                .unwrap();
            let rect = owner.children().find(|n| n.has_tag_name("rect")).unwrap();
            ["width", "height"].map(|attr| rect.attribute(attr).unwrap().to_owned())
        };
        assert_eq!(
            dimensions(&actual),
            dimensions(&expected),
            "{layout}: descendant CSS must use the same run metrics as equivalent inline typography"
        );
        let fonts = NativeFontContext::system().unwrap();
        let advance = |size| {
            fonts
                .shape(
                    "Wide",
                    &TextStyle {
                        font_size: size,
                        font_family: Some("Arial".into()),
                        ..Default::default()
                    },
                )
                .unwrap()
                .bounds
                .unwrap()
                .right
        };
        let growth = dimensions(&actual)[0].parse::<f64>().unwrap()
            - dimensions(&small)[0].parse::<f64>().unwrap();
        assert!(
            (growth - (advance(32.0) - advance(16.0))).abs() < 0.1,
            "{layout}: allocated width must grow by the independently shaped run advance: {growth}"
        );
        let doc = roxmltree::Document::parse(actual["svg"].as_str().unwrap()).unwrap();
        assert!(
            doc.descendants().any(|n| n
                .attribute("style")
                .is_some_and(|s| s.contains("font-size:32px"))
                && n.descendants()
                    .any(|child| child.text().is_some_and(|t| t.contains("Wide")))),
            "{layout}: the exported large run must retain its resolved size"
        );
    }
}

#[test]
fn rich_html_emphasis_matches_explicit_styles_through_wrapping_and_export() {
    for layout in ["dagre", "elk"] {
        for (name, label, runs, min_rows) in [
            (
                "nested",
                "Plain <strong>bold <em>italic</em></strong> <code>code</code> end",
                json!([
                    ["Plain ", "16px", "400", "normal"],
                    ["bold ", "16px", "700", "normal"],
                    ["italic", "16px", "700", "italic"],
                    [" code end", "16px", "400", "normal"]
                ]),
                1,
            ),
            (
                "wrapped",
                "Plain <strong>wide wide wide wide wide wide</strong> <em>italic italic</em> end",
                json!([
                    ["Plain ", "16px", "400", "normal"],
                    ["wide wide wide wide wide wide", "16px", "700", "normal"],
                    [" ", "16px", "400", "normal"],
                    ["italic italic", "16px", "400", "italic"],
                    [" end", "16px", "400", "normal"]
                ]),
                3,
            ),
            (
                "breaks",
                "Plain<br/><strong>bold <em>italic</em></strong><br/><code>code</code> end",
                json!([
                    ["Plain", "16px", "400", "normal"],
                    ["bold ", "16px", "700", "normal"],
                    ["italic", "16px", "700", "italic"],
                    ["code end", "16px", "400", "normal"]
                ]),
                3,
            ),
            (
                "reset",
                "<span style='font-weight:initial;font-style:initial'>Reset</span> Keep",
                json!([
                    ["Reset", "16px", "400", "normal"],
                    [" Keep", "16px", "700", "italic"]
                ]),
                1,
            ),
            (
                "relative",
                "<span style='font-weight:349.5'>Light <strong>bold</strong></span>",
                json!([
                    ["Light ", "16px", "349.5", "normal"],
                    ["bold", "16px", "400", "normal"]
                ]),
                1,
            ),
        ] {
            let renderer = Renderer::new().with_engine(Engine::new().with_site_config(MermaidConfig::from_value(json!({
                "layout":layout, "htmlLabels":true, "traceSource":true, "fontFamily":"Arial", "flowchart":{"wrappingWidth":100}, "themeCSS":if name == "reset" {".nodeLabel{font-weight:700;font-style:italic}"} else {""}
            }))));
            let draw = |text| {
                mermaid_trace_rs::render_with(
                    &renderer,
                    "emphasis",
                    &format!("flowchart LR\nA[\"{text}\"]\n"),
                )
                .unwrap()
            };
            let mut actual = draw(label);
            let styled = label
                .replace(
                    "<strong>",
                    if name == "relative" {
                        "<span style='font-weight:400'>"
                    } else {
                        "<span style='font-weight:700'>"
                    },
                )
                .replace("</strong>", "</span>")
                .replace("<em>", "<span style='font-style:italic'>")
                .replace("</em>", "</span>")
                .replace("<code>", "<span style='font-family:monospace'>")
                .replace("</code>", "</span>")
                .replace("font-weight:initial", "font-weight:normal")
                .replace("font-style:initial", "font-style:normal");
            assert_eq!(
                support::strip_trace(actual["svg"].as_str().unwrap()),
                support::strip_trace(draw(&styled)["svg"].as_str().unwrap()),
                "{layout}/{name}: semantic HTML must have the same measured and painted output as its explicit font styles"
            );
            let doc = roxmltree::Document::parse(actual["svg"].as_str().unwrap()).unwrap();
            let owner = doc
                .descendants()
                .find(|node| node.attribute("data-mt-role") == Some("node-label"))
                .unwrap();
            assert!(
                owner
                    .descendants()
                    .filter(|node| node.has_tag_name("text"))
                    .count()
                    >= min_rows,
                "{layout}/{name}: wrapping and explicit breaks must survive"
            );
            if let Ok(directory) = std::env::var("TRACE_CSS_LAYER_ARTIFACTS") {
                actual["fixture"] = json!({"label":label, "runs":runs});
                std::fs::write(
                    std::path::Path::new(&directory).join(format!("emphasis-{layout}-{name}.json")),
                    serde_json::to_vec(&actual).unwrap(),
                )
                .unwrap();
            }
        }
    }
}

#[test]
fn rich_css_labels_preserve_owned_source_for_nodes_edges_and_groups() {
    let label = "<span class='large'>Wide</span> small 😀";
    for layout in ["dagre", "elk"] {
        let source = format!(
            "flowchart LR\nsubgraph G[\"{label}\"]\nA[\"{label}\"] e@-->|\"{label}\"| B[Beta]\nend\n"
        );
        let draw = |traced| {
            let renderer = Renderer::new().with_engine(Engine::new().with_site_config(MermaidConfig::from_value(json!({
                "layout":layout, "htmlLabels":true, "traceSource":traced, "themeCSS":".large{font-size:32px}"
            }))));
            mermaid_trace_rs::render_with(&renderer, "rich-owners", &source).unwrap()
        };
        let mapped = draw(true);
        assert_eq!(mapped["mapping"]["source"], source);
        assert_eq!(
            support::strip_trace(mapped["svg"].as_str().unwrap()),
            support::strip_trace(draw(false)["svg"].as_str().unwrap()),
            "{layout}: CSS preparation must not leak mapping into plain output"
        );
        let doc = roxmltree::Document::parse(mapped["svg"].as_str().unwrap()).unwrap();
        let source_utf16 = source.encode_utf16().collect::<Vec<_>>();
        for role in ["node-label", "edge-label", "control-label"] {
            let owner = doc
                .descendants()
                .find(|node| {
                    node.attribute("data-mt-role") == Some(role)
                        && node.descendants().any(|child| {
                            child.has_tag_name("tspan") && child.text() == Some("Wide")
                        })
                })
                .unwrap_or_else(|| panic!("{layout}: missing {role}"));
            let start: usize = owner.attribute("data-mt-start").unwrap().parse().unwrap();
            let end: usize = owner.attribute("data-mt-end").unwrap().parse().unwrap();
            assert_eq!(
                String::from_utf16(&source_utf16[start..end]).unwrap(),
                label,
                "{layout}/{role}: exact owned source"
            );
        }
    }
}

#[test]
fn trusted_css_typography_reaches_layout_before_export() {
    let mut failures = Vec::new();
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            for (owner, html_selector, svg_selector, declaration) in [
                (
                    "node",
                    ".target .nodeLabel",
                    ".target .label text",
                    "style A font-size:32px",
                ),
                (
                    "edge",
                    ".edgeLabel",
                    ".edgeLabel text",
                    "linkStyle 0 font-size:32px",
                ),
                (
                    "group",
                    ".cluster-label",
                    ".cluster-label text",
                    "style G font-size:32px",
                ),
            ] {
                let source = "flowchart LR\n%% 😀\nsubgraph G[Group WWWiii WWWiii WWWiii WWWiii WWWiii]\nA[Alpha WWWiii] e@-->|Next WWWiii| B[Beta]\nend\n";
                let draw = |css: &str, declaration: &str| {
                    // Bind after styles establish the subgraph's rendered CSS owner.
                    let source = format!("{source}{declaration}\nclass A target\n");
                    let renderer = Renderer::new().with_engine(Engine::new().with_site_config(
                        MermaidConfig::from_value(json!({
                            "traceSource":true, "htmlLabels":html, "layout":layout,
                            "themeCSS":css, "deterministicIds":true,
                            "deterministicIDSeed":"css-layout"
                        })),
                    ));
                    let result =
                        mermaid_trace_rs::render_with(&renderer, "css-layout", &source).unwrap();
                    assert_eq!(result["mapping"]["source"], source);
                    let doc = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                    for (key, role, text) in [
                        ("node:A", "node-label", "Alpha WWWiii"),
                        ("edge:e", "edge-label", "Next WWWiii"),
                        (
                            "flowchart:subgraph:G",
                            "control-label",
                            "Group WWWiii WWWiii WWWiii WWWiii WWWiii",
                        ),
                    ] {
                        let label = doc
                            .descendants()
                            .find(|n| {
                                n.attribute("data-mt-key") == Some(key)
                                    && n.attribute("data-mt-role") == Some(role)
                            })
                            .unwrap();
                        let start: usize =
                            label.attribute("data-mt-start").unwrap().parse().unwrap();
                        let end: usize = label.attribute("data-mt-end").unwrap().parse().unwrap();
                        assert_eq!(
                            String::from_utf16(
                                &source.encode_utf16().collect::<Vec<_>>()[start..end]
                            )
                            .unwrap(),
                            text
                        );
                    }
                    // Compare allocated shapes and routes, independently of the CSS/font transport.
                    ["node:A", "node:B", "flowchart:subgraph:G", "edge:e"]
                        .into_iter()
                        .map(|key| {
                            let owner = doc
                                .descendants()
                                .find(|n| {
                                    n.attribute("data-mt-key") == Some(key)
                                        && !n.has_attribute("data-mt-label")
                                })
                                .unwrap();
                            let shape = owner
                                .children()
                                .find(|n| n.has_tag_name("rect") || n.has_tag_name("path"))
                                .unwrap_or(owner);
                            (
                                key.to_string(),
                                ["width", "height", "d"]
                                    .into_iter()
                                    .filter_map(|attr| {
                                        shape
                                            .attribute(attr)
                                            .map(|value| (attr.to_string(), value.to_string()))
                                    })
                                    .collect::<Vec<_>>(),
                            )
                        })
                        .collect::<Vec<_>>()
                };
                assert_eq!(
                    draw("", declaration),
                    draw(".absent{font-size:99px}", declaration),
                    "nonmatching CSS must not alter authored geometry: {layout}/{html}/{owner}"
                );
                let expected = draw("", declaration);
                let selector = if html { html_selector } else { svg_selector };
                for layered in [false, true] {
                    let rule = format!("{selector}{{font-size:32px!important}}");
                    let css = if layered {
                        format!("@layer typography{{{rule}}}")
                    } else {
                        rule
                    };
                    let actual = draw(&css, "");
                    if actual != expected {
                        failures.push(format!("{layout}/html={html}/{owner}/layered={layered}:\nactual {actual:?}\nexpected {expected:?}"));
                    }
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "CSS must affect layout before export:\n{}",
        failures.join("\n")
    );
}

#[test]
fn trusted_layered_css_preserves_exported_font_and_source() {
    let source = "flowchart LR\n%% 😀\nA[Alpha WWWiii]\n";
    for layout in ["dagre", "elk"] {
        for look in ["classic", "neo", "handDrawn"] {
            for (name, css, expected) in [
                ("flat", ".nodeLabel{font-size:32px!important}", 32),
                (
                    "layer",
                    "@layer theme{.nodeLabel{font-size:32px!important}}",
                    32,
                ),
                (
                    "rollback",
                    "@layer base,theme;@layer base{.nodeLabel{font-size:24px}}@layer theme{.nodeLabel{font-size:revert-layer!important}}",
                    24,
                ),
            ] {
                let draw = |traced| {
                    let renderer = Renderer::new().with_engine(Engine::new().with_site_config(MermaidConfig::from_value(json!({
                        "traceSource":traced, "htmlLabels":true, "layout":layout, "look":look,
                        "handDrawnSeed":42, "themeCSS":css, "deterministicIds":true, "deterministicIDSeed":"layers"
                    }))));
                    mermaid_trace_rs::render_with(&renderer, "layers", source).unwrap()
                };
                let result = draw(true);
                let svg = result["svg"].as_str().unwrap();
                let doc = roxmltree::Document::parse(svg).unwrap();
                let label = doc
                    .descendants()
                    .find(|n| n.attribute("data-mt-role") == Some("node-label"))
                    .unwrap();
                let text = label
                    .descendants()
                    .find(|n| n.has_tag_name("text"))
                    .unwrap();
                assert!(
                    text.attribute("style")
                        .unwrap()
                        .contains(&format!("font-size:{expected}px;")),
                    "{layout}/{look}/{name}: {:?}",
                    text.attribute("style")
                );
                let start: usize = label.attribute("data-mt-start").unwrap().parse().unwrap();
                let end: usize = label.attribute("data-mt-end").unwrap().parse().unwrap();
                let utf16: Vec<_> = source.encode_utf16().collect();
                assert_eq!(
                    String::from_utf16(&utf16[start..end]).unwrap(),
                    "Alpha WWWiii"
                );
                assert_eq!(result["mapping"]["source"], source);
                assert_eq!(
                    support::strip_trace(svg),
                    support::strip_trace(draw(false)["svg"].as_str().unwrap())
                );
                if let Ok(directory) = std::env::var("TRACE_CSS_LAYER_ARTIFACTS") {
                    std::fs::write(
                        std::path::Path::new(&directory)
                            .join(format!("{layout}-{look}-{name}.json")),
                        serde_json::to_vec(&result).unwrap(),
                    )
                    .unwrap();
                }
            }
        }
    }
}
