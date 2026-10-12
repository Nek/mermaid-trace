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
