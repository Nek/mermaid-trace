mod support;

use serde_json::json;

#[test]
fn configured_text_limits_preserve_exact_original_source_and_static_mapping() {
    for body in [
        "flowchart LR\nA[Alpha 😀] --> B[Beta]",
        "flowchart-elk LR\nA[Alpha 😀] --> B[Beta]",
        "sequenceDiagram\nA->>B: Alpha 😀",
        "gantt\ndateFormat YYYY-MM-DD\nAlpha 😀 :a, 2026-01-01, 1d",
        "journey\nsection Work\nAlpha 😀: 5: A",
        "kanban\n  todo[Todo]\n    a[Alpha 😀]",
        "stateDiagram-v2\nstate \"Alpha 😀\" as A",
    ] {
        let source = format!("---\nconfig: {{maxTextSize: 999999}}\n---\n%% original 😀\n{body}")
            .replace('\n', "\r\n");
        let units = source.encode_utf16().count();
        let make_renderer = |limit, trace| {
            merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
                merman::MermaidConfig::from_value(
                    json!({"maxTextSize":limit,"traceSource":trace,"htmlLabels":false}),
                ),
            ))
        };
        let mapped =
            mermaid_trace_rs::render_with(&make_renderer(units, true), "text-limit", &source)
                .unwrap();
        let plain =
            mermaid_trace_rs::render_with(&make_renderer(units, false), "text-limit", &source)
                .unwrap();
        assert_eq!(
            support::strip_trace(mapped["svg"].as_str().unwrap()),
            support::strip_trace(plain["svg"].as_str().unwrap())
        );
        assert_eq!(mapped["mapping"]["source"], source);
        let start = source[..source.find("Alpha 😀").unwrap()]
            .encode_utf16()
            .count();
        let span = json!({"start":start,"end":start+"Alpha 😀".encode_utf16().count()});
        assert!(
            mapped["mapping"]["pieces"]
                .as_array()
                .unwrap()
                .iter()
                .any(|piece| piece["labelSpan"] == span),
            "{body}"
        );
        for trace in [false, true] {
            let error = mermaid_trace_rs::render_with(
                &make_renderer(units - 1, trace),
                "text-limit",
                &source,
            )
            .err()
            .expect("lower host limit must reject rendering");
            assert!(
                error.contains("maxTextSize") && error.contains("UTF-16"),
                "{error}"
            );
        }
    }
}

#[test]
fn higher_native_text_limit_cannot_bypass_trace_fixed_admission_cap() {
    let renderer = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(json!({"maxTextSize":100_000,"traceSource":true})),
    ));
    let source = format!("flowchart LR\nA[Alpha]\n%% {}", "😀".repeat(25_000));
    assert_eq!(
        mermaid_trace_rs::render_with(&renderer, "text-limit", &source)
            .err()
            .unwrap(),
        "Invalid Mermaid source length"
    );
}
