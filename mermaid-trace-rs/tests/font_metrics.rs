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
