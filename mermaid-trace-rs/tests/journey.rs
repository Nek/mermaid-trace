mod support;
use serde_json::{Value, json};

fn selected(source: &str, span: &Value) -> String {
    let text: Vec<_> = source.encode_utf16().collect();
    String::from_utf16(
        &text[span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
    )
    .unwrap()
}

#[test]
fn journey_2_pinned_corpus_preserves_independent_task_labels_and_static_output() {
    let directory =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor/merman/fixtures/journey");
    let mut fixtures: Vec<_> = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "mmd"))
        .collect();
    fixtures.sort();
    assert_eq!(
        fixtures.len(),
        26,
        "review the inventory when the pinned corpus changes"
    );
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for path in fixtures {
        let source = std::fs::read_to_string(&path).unwrap();
        let golden: Value = serde_json::from_str(
            &std::fs::read_to_string(path.with_extension("golden.json")).unwrap(),
        )
        .unwrap();
        let result = mermaid_trace_rs::render("journey-corpus", &source)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let tasks: Vec<_> = result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|piece| piece["kind"] == "node")
            .collect();
        let expected = golden["model"]["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(), expected.len(), "{}", path.display());
        for (index, (piece, task)) in tasks.iter().zip(expected).enumerate() {
            assert_eq!(piece["domId"], format!("journey:task:{index}"));
            assert_eq!(
                selected(&source, &piece["labelSpan"]),
                task["task"].as_str().unwrap().trim(),
                "{}",
                path.display()
            );
        }
        let baseline = mermaid_trace_rs::render_with(&plain, "journey-corpus", &source).unwrap();
        assert_eq!(
            support::strip_trace(result["svg"].as_str().unwrap()),
            support::strip_trace(baseline["svg"].as_str().unwrap()),
            "{}",
            path.display()
        );
        if let Some(title) = golden["model"]["title"]
            .as_str()
            .filter(|title| !title.trim().is_empty())
        {
            let piece = result["mapping"]["pieces"]
                .as_array()
                .unwrap()
                .iter()
                .find(|piece| piece["domId"] == "journey:title")
                .expect("authored corpus title");
            assert_eq!(
                selected(&source, &piece["labelSpan"]),
                title.trim(),
                "{}",
                path.display()
            );
        }
        if path.file_name().unwrap() == "upstream_html_demos_journey_journey_diagram_demo_001.mmd" {
            let piece = result["mapping"]["pieces"]
                .as_array()
                .unwrap()
                .iter()
                .find(|piece| piece["domId"] == "journey:title")
                .expect("frontmatter corpus title");
            assert_eq!(selected(&source, &piece["labelSpan"]), "My working day");
        }
    }
}

#[test]
fn journey_2_title_yaml_origin_and_body_precedence_preserve_static_svg() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for (fields, payload) in [
                ("title: Plain 😀\r\n", "Plain 😀"),
                ("title: 'Quoted 😀'\r\n", "Quoted 😀"),
                (
                    "title: \"Escaped \\\"title\\\" 😀\"\r\n",
                    "Escaped \\\"title\\\" 😀",
                ),
                ("name: &name Alias 😀\r\ntitle: *name\r\n", "*name"),
                (
                    "title: |\r\n  First 😀\r\n  Second\r\n",
                    "First 😀\r\n  Second\r\n",
                ),
                (
                    "title: >-\r\n  First 😀\r\n  Second\r\n",
                    "First 😀\r\n  Second\r\n",
                ),
            ] {
                for body_title in [false, true] {
                    let source = format!(
                        "---\r\n{fields}config:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n---\r\njourney\r\n{}Task : 5 : Alice\r\n",
                        if body_title {
                            "title Body 😀\r\n"
                        } else {
                            ""
                        }
                    );
                    let result = mermaid_trace_rs::render("journey-title", &source).unwrap();
                    let titles: Vec<_> = result["mapping"]["pieces"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|p| p["domId"] == "journey:title")
                        .collect();
                    assert_eq!(titles.len(), 1, "one visible title owner: {source}");
                    assert_eq!(
                        selected(&source, &titles[0]["labelSpan"]),
                        if body_title { "Body 😀" } else { payload }
                    );
                    assert!(
                        selected(&source, &titles[0]["span"]).starts_with(if body_title {
                            "title Body"
                        } else {
                            "title:"
                        })
                    );
                    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                    assert!(svg.descendants().any(|n| n.attribute("data-mt-key")
                        == Some("journey:title")
                        && n.attribute("data-mt-role")
                            == Some(if body_title {
                                "control"
                            } else {
                                "control-label"
                            })));
                    let baseline =
                        mermaid_trace_rs::render_with(&plain, "journey-title", &source).unwrap();
                    assert_eq!(
                        support::strip_trace(result["svg"].as_str().unwrap()),
                        support::strip_trace(baseline["svg"].as_str().unwrap())
                    );
                }
            }
            for fields in ["", "title: ''\r\n"] {
                let source = format!(
                    "---\r\n{fields}config:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n---\r\njourney\r\nTask : 5 : Alice\r\n"
                );
                let result = mermaid_trace_rs::render("journey-empty-title", &source).unwrap();
                assert!(
                    !result["mapping"]["pieces"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|p| p["domId"] == "journey:title")
                );
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                assert!(
                    !svg.descendants()
                        .any(|n| n.attribute("data-mt-key") == Some("journey:title"))
                );
            }
        }
    }
}
