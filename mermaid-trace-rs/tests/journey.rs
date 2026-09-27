mod support;
use merman::{OperationControl, RenderOutput, RenderRequest, SvgRequest};
use serde_json::{Value, json};

fn selected(source: &str, span: &Value) -> String {
    let text: Vec<_> = source.encode_utf16().collect();
    String::from_utf16(
        &text[span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
    )
    .unwrap()
}

#[test]
fn journey_2_number_boundary_corpus_preserves_models_layout_and_safe_artifacts() {
    use merman::{Engine, ParseOptions, RenderSemanticModel};
    let corpus: Value =
        serde_json::from_str(include_str!("fixtures/journey-score-numbers.json")).unwrap();
    let engine = Engine::new();
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for case in corpus["cases"].as_array().unwrap() {
        let score = case["source"].as_str().unwrap();
        let source = format!("journey\r\n%% 😀\r\nTask : {score} : Alice\r\n");
        let parsed = engine
            .parse_diagram_for_render_model_sync(&source, ParseOptions::strict())
            .unwrap()
            .unwrap();
        let RenderSemanticModel::Journey(model) = parsed.model() else {
            panic!("journey model")
        };
        let task = &model.tasks[0];
        let is_nan = case["value"] == "NaN";
        assert_eq!(task.score_is_nan, is_nan, "NaN semantics for {score:?}");
        if !is_nan {
            let expected = u64::from_str_radix(case["bits"].as_str().unwrap(), 16).unwrap();
            assert_eq!(
                task.score.to_bits(),
                expected,
                "Number semantics for {score:?}"
            );
        }
        let wire = serde_json::to_string(task).unwrap();
        let round_trip: merman::diagrams::journey::JourneyRenderTask =
            serde_json::from_str(&wire).unwrap();
        assert_eq!(
            round_trip.score.to_bits(),
            task.score.to_bits(),
            "typed score round trip {score:?}: {wire}"
        );
        assert_eq!(round_trip.score_is_nan, is_nan);
        if score == "3e-1" {
            assert_eq!(serde_json::to_value(task).unwrap()["score"], json!(0.3));
        }
        if score == "0x5" {
            assert_eq!(serde_json::to_value(task).unwrap()["score"], json!(5));
        }
        let RenderOutput::LayoutJson(Some(layout)) = renderer
            .render(RenderRequest::layout_json(
                &source,
                OperationControl::new(),
                SvgRequest::default(),
            ))
            .unwrap()
        else {
            panic!("layout")
        };
        assert_eq!(
            layout.layout()["layout"]["JourneyDiagram"]["tasks"][0]["mouth"],
            case["mouth"],
            "mouth {score:?}"
        );
        let layout_score = &layout.layout()["layout"]["JourneyDiagram"]["tasks"][0]["score"];
        assert_eq!(
            layout_score,
            &serde_json::to_value(task).unwrap()["score"],
            "layout retains score {score:?}"
        );
        let result = mermaid_trace_rs::render("journey-score", &source).unwrap();
        let baseline = mermaid_trace_rs::render_with(&plain, "journey-score", &source).unwrap();
        assert_eq!(
            support::strip_trace(result["svg"].as_str().unwrap()),
            support::strip_trace(baseline["svg"].as_str().unwrap()),
            "numeric static parity {score:?}"
        );
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let face = svg
            .descendants()
            .find(|n| n.attribute("class") == Some("face"));
        let native: Vec<Value> = serde_json::from_str(
            svg.descendants()
                .find_map(|n| n.attribute("data-mt-native"))
                .unwrap(),
        )
        .unwrap();
        let property = native.iter().find(|p| p["property"] == "score");
        let owned = case["ownedSource"].as_str().unwrap();
        if owned.is_empty() {
            assert!(
                property.is_none(),
                "no invented empty-score occurrence {score:?}"
            );
        } else {
            let span = &property.expect("authored score")["span"];
            assert_eq!(
                &source[span["start"].as_u64().unwrap() as usize
                    ..span["end"].as_u64().unwrap() as usize],
                owned,
                "exact lexical score {score:?}"
            );
        }
        if case["faceY"].is_null() {
            assert!(face.is_none(), "no unrenderable face {score:?}");
            assert!(
                !svg.descendants()
                    .any(|n| n.attribute("data-mt-key") == Some("journey:score:0")
                        && n.has_attribute("data-mt-role")),
                "no phantom score control {score:?}"
            );
            let native: Vec<Value> = serde_json::from_str(
                svg.descendants()
                    .find_map(|n| n.attribute("data-mt-native"))
                    .unwrap(),
            )
            .unwrap();
            let property = native
                .iter()
                .find(|p| p["property"] == "score")
                .expect("score provenance");
            assert_eq!(property["classification"], "unrenderable-score");
            assert_eq!(property["ownerDomId"], "journey:task:0");
        } else {
            let actual: f64 = face
                .expect("finite face")
                .attribute("cy")
                .unwrap()
                .parse()
                .unwrap();
            assert_eq!(
                format!("{:016x}", actual.to_bits()),
                case["faceBits"].as_str().unwrap(),
                "face arithmetic for {score:?}"
            );
        }
    }
}

#[test]
fn journey_2_scores_preserve_number_semantics_and_exact_visual_ownership() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for (score, expected_y) in [
                ("3.5", 345.0),
                ("0x5", 300.0),
                ("0b11", 360.0),
                ("0o3", 360.0),
                ("3e-1", 441.0),
                ("-0.5", 465.0),
                ("+3.5", 345.0),
                ("3.00000001", 359.9999997),
            ] {
                let source = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n---\r\njourney\r\nTask 😀 : {score} : Alice\r\n"
                );
                let result = mermaid_trace_rs::render("journey-score", &source).unwrap();
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let face = svg
                    .descendants()
                    .find(|n| n.attribute("class") == Some("face"))
                    .expect("renderable face");
                let actual_y: f64 = face.attribute("cy").unwrap().parse().unwrap();
                assert!(
                    (actual_y - expected_y).abs() < 1e-10,
                    "score {score}/{look}/{html}: {actual_y} != {expected_y}"
                );
                assert_eq!(face.attribute("data-mt-key"), Some("journey:score:0"));
                let property = result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|p| p["domId"] == "journey:score:0")
                    .unwrap();
                assert_eq!(selected(&source, &property["span"]), score);
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "journey-score", &source).unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn journey_2_unrenderable_scores_preserve_task_ownership_without_phantom_geometry() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for value in [
                "bad 😀",
                "Task",
                "NaN",
                "Infinity",
                "-Infinity",
                "1e309",
                "",
            ] {
                let source = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n---\r\njourney\r\nTask : {value} : Alice\r\n"
                );
                let result = mermaid_trace_rs::render("journey-score", &source).unwrap();
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let faces: Vec<_> = svg
                    .descendants()
                    .filter(|node| node.attribute("class") == Some("face"))
                    .collect();
                assert_eq!(
                    faces.len(),
                    usize::from(value.is_empty()),
                    "unrenderable scores have no phantom face: {value}/{look}/{html}"
                );
                assert_eq!(
                    svg.descendants()
                        .filter(|node| node.has_tag_name("circle"))
                        .count(),
                    if value.is_empty() { 5 } else { 2 },
                    "only the authored actor/legend and a renderable default face have circles"
                );
                assert_eq!(
                    svg.descendants()
                        .filter(|node| node.attribute("class") == Some("mouth"))
                        .count(),
                    usize::from(value.is_empty()),
                    "no default-position invalid mouth"
                );
                assert!(
                    !svg.descendants().any(|node| node.attribute("data-mt-key")
                        == Some("journey:score:0")
                        && node.has_attribute("data-mt-role")),
                    "no nonexistent score control"
                );
                if value.is_empty() {
                    assert_eq!(faces[0].attribute("cy"), Some("450"));
                } else {
                    let native: Vec<Value> = serde_json::from_str(
                        svg.descendants()
                            .find_map(|node| node.attribute("data-mt-native"))
                            .unwrap(),
                    )
                    .unwrap();
                    let property = native
                        .iter()
                        .find(|piece| piece["semanticId"] == "score:0")
                        .expect("authored score retained");
                    assert_eq!(property["kind"], "nonvisual");
                    assert_eq!(property["classification"], "unrenderable-score");
                    assert_eq!(property["ownerDomId"], "journey:task:0");
                    assert_eq!(
                        &source[property["span"]["start"].as_u64().unwrap() as usize
                            ..property["span"]["end"].as_u64().unwrap() as usize],
                        value
                    );
                }
                let task = result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|piece| piece["domId"] == "journey:task:0")
                    .unwrap();
                assert_eq!(
                    selected(&source, &task["span"]),
                    format!("Task : {value} : Alice")
                );
                assert_eq!(selected(&source, &task["labelSpan"]), "Task");
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "journey-score", &source).unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn journey_2_text_modes_preserve_label_groups_and_native_palette_cycles() {
    for mode in ["fo", "old", "tspan", "other"] {
        for br in ["<br>", "<BR>", "<br/>", "<br />"] {
            for look in ["classic", "neo", "handDrawn"] {
                for html in [false, true] {
                    let config = |trace| {
                        merman::MermaidConfig::from_value(
                            json!({"traceSource":trace,"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace","journey":{"sectionColours":["#123456","#abcdef"]}}),
                        )
                    };
                    let mapped = merman::Renderer::new()
                        .with_engine(merman::Engine::new().with_site_config(config(true)));
                    let plain = merman::Renderer::new()
                        .with_engine(merman::Engine::new().with_site_config(config(false)));
                    let source = format!(
                        "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n  journey:\r\n    textPlacement: {mode}\r\n    taskFontSize: 18\r\n    sectionColours: ['#fedcba']\r\n    sectionFills: ['#fedcba']\r\n---\r\njourney\r\n%% 😀\r\nBefore :5: Alice\r\nsection Unused\r\nsection Day{br}Line\r\nTask{br}Line :5: Alice\r\nsection Night\r\nOther :3: Bob\r\nsection Day{br}Line\r\nAgain :4: Bob\r\nsection End\r\nFinal :4: Alice\r\n"
                    );
                    let RenderOutput::Svg(Some(output)) = mapped
                        .render(RenderRequest::svg(
                            &source,
                            OperationControl::new(),
                            SvgRequest::default(),
                        ))
                        .unwrap()
                    else {
                        panic!("no native SVG")
                    };
                    let raw = roxmltree::Document::parse(output.svg()).unwrap();
                    if mode != "fo" && mode != "old" {
                        for (section, colour) in
                            ["#fff", "#123456", "#abcdef", "#fedcba"].iter().enumerate()
                        {
                            let key = format!("journey:section:{}", section + 1);
                            let label = raw
                                .descendants()
                                .find(|node| {
                                    node.attribute("data-mt-key") == Some(key.as_str())
                                        && node.attribute("data-mt-label") == Some("true")
                                })
                                .unwrap();
                            assert!(
                                label
                                    .descendants()
                                    .filter(|node| node.has_tag_name("text"))
                                    .all(|text| text.attribute("fill") == Some(*colour)),
                                "section run text palette: {section}/{mode}"
                            );
                        }
                    }
                    for (task, colour) in ["black", "#fff", "#123456", "#abcdef", "#fedcba"]
                        .iter()
                        .enumerate()
                    {
                        let key = format!("journey:task:{task}");
                        let labels: Vec<_> = raw
                            .descendants()
                            .filter(|node| {
                                node.attribute("data-mt-key") == Some(key.as_str())
                                    && node.attribute("data-mt-label") == Some("true")
                            })
                            .collect();
                        assert_eq!(
                            labels.len(),
                            1,
                            "one native label identity: {mode}/{look}/{html}"
                        );
                        let label = labels[0];
                        assert!(
                            label.has_tag_name(if mode == "fo" {
                                "switch"
                            } else if mode == "old" {
                                "text"
                            } else {
                                "g"
                            }),
                            "native text placement {mode}"
                        );
                        let texts: Vec<_> = label
                            .descendants()
                            .filter(|node| node.has_tag_name("text"))
                            .collect();
                        assert_eq!(texts.len(), if task == 1 && mode != "old" { 2 } else { 1 });
                        if mode == "old" {
                            assert!(!label.descendants().any(|node| node.has_tag_name("tspan")));
                            if task == 1 {
                                assert_eq!(label.text(), Some(format!("Task{br}Line ").as_str()));
                            }
                        } else if mode != "fo" {
                            assert!(
                                texts
                                    .iter()
                                    .all(|text| text.attribute("fill") == Some(*colour)),
                                "palette index must follow section runs: {task}/{mode}"
                            );
                            if task == 1 {
                                assert_eq!(
                                    texts
                                        .iter()
                                        .map(|text| text
                                            .children()
                                            .find(|node| node.has_tag_name("tspan"))
                                            .unwrap()
                                            .attribute("dy")
                                            .unwrap())
                                        .collect::<Vec<_>>(),
                                    ["-9", "9"]
                                );
                            }
                        }
                    }
                    let result =
                        mermaid_trace_rs::render_with(&mapped, "journey-text", &source).unwrap();
                    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                    assert_eq!(
                        svg.descendants()
                            .filter(
                                |node| node.attribute("data-mt-key") == Some("journey:task:1")
                                    && node.attribute("data-mt-role") == Some("node-label")
                            )
                            .count(),
                        1,
                        "portable label: {mode}/{look}/{html}: {}",
                        result["svg"]
                    );
                    let task = result["mapping"]["pieces"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|piece| piece["domId"] == "journey:task:1")
                        .unwrap();
                    assert_eq!(
                        selected(&source, &task["labelSpan"]),
                        format!("Task{br}Line")
                    );
                    let baseline =
                        mermaid_trace_rs::render_with(&plain, "journey-text", &source).unwrap();
                    assert_eq!(
                        support::strip_trace(result["svg"].as_str().unwrap()),
                        support::strip_trace(baseline["svg"].as_str().unwrap())
                    );
                }
            }
        }
    }
}

#[test]
fn journey_2_occurrences_keep_title_replacement_fallback_and_accessibility_origins() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for final_title in ["title Last 😀", "title title", "title ", "title   "] {
                let source = format!(
                    "---\r\ntitle: Configured 😀\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n---\r\njourney\r\n  title First 😀  \r\n{final_title}\r\naccTitle: Earlier\r\naccTitle: accTitle\r\naccDescr: Earlier\r\naccDescr {{\r\n  First 😀\r\n  second\r\n}}\r\nTask : 5 : Alice\r\n"
                );
                let result = mermaid_trace_rs::render("journey-occurrences", &source).unwrap();
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let native: Vec<Value> = serde_json::from_str(
                    svg.descendants()
                        .find_map(|node| node.attribute("data-mt-native"))
                        .unwrap(),
                )
                .unwrap();
                let slice = |span: &Value| {
                    &source[span["start"].as_u64().unwrap() as usize
                        ..span["end"].as_u64().unwrap() as usize]
                };
                let titles: Vec<_> = native
                    .iter()
                    .filter(|piece| piece["semanticId"] == "title" && piece["origin"] == "body")
                    .collect();
                assert_eq!(titles.len(), 2, "retain both body declarations");
                assert_eq!(slice(&titles[0]["span"]), "title First 😀");
                assert_eq!(slice(&titles[1]["span"]), final_title.trim_end());
                assert_eq!(titles[0]["effective"], false);
                assert_eq!(titles[1]["effective"], true);
                let empty = final_title.trim() == "title";
                for piece in &titles {
                    assert_eq!(piece["kind"], if empty { "nonvisual" } else { "control" });
                }
                let primary = result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|piece| piece["domId"] == "journey:title")
                    .find(|piece| piece["effective"] == true || piece["origin"] != "body");
                let binding = svg.descendants().find(|node| {
                    node.attribute("data-mt-key") == Some("journey:title")
                        && node.has_attribute("data-mt-role")
                });
                if final_title == "title   " {
                    assert!(
                        primary.is_none(),
                        "native whitespace title suppresses YAML fallback"
                    );
                    assert!(
                        !svg.descendants()
                            .any(|node| node.attribute("data-mt-key") == Some("journey:title"))
                    );
                    let baseline =
                        mermaid_trace_rs::render_with(&plain, "journey-occurrences", &source)
                            .unwrap();
                    assert_eq!(
                        support::strip_trace(result["svg"].as_str().unwrap()),
                        support::strip_trace(baseline["svg"].as_str().unwrap())
                    );
                    continue;
                }
                let primary = primary.expect("visible title owner");
                assert_eq!(
                    selected(&source, &primary["labelSpan"]),
                    if empty {
                        "Configured 😀"
                    } else if final_title == "title title" {
                        "title"
                    } else {
                        "Last 😀"
                    }
                );
                let binding = binding.expect("visible title binding");
                let start: usize = binding.attribute("data-mt-start").unwrap().parse().unwrap();
                let end: usize = binding.attribute("data-mt-end").unwrap().parse().unwrap();
                let utf16: Vec<_> = source.encode_utf16().collect();
                assert_eq!(
                    String::from_utf16(&utf16[start..end]).unwrap(),
                    if empty {
                        "Configured 😀"
                    } else {
                        final_title
                    }
                );
                let accessibility: Vec<_> = native
                    .iter()
                    .filter(|piece| piece["classification"] == "accessibility")
                    .collect();
                assert_eq!(accessibility.len(), 4);
                for (index, (statement, payload)) in [
                    ("accTitle: Earlier", "Earlier"),
                    ("accTitle: accTitle", "accTitle"),
                    ("accDescr: Earlier", "Earlier"),
                    (
                        "accDescr {\r\n  First 😀\r\n  second\r\n}",
                        "First 😀\r\n  second",
                    ),
                ]
                .iter()
                .enumerate()
                {
                    assert_eq!(slice(&accessibility[index]["span"]), *statement);
                    assert_eq!(slice(&accessibility[index]["labelSpan"]), *payload);
                    assert_eq!(accessibility[index]["effective"], index % 2 == 1);
                    assert_eq!(accessibility[index]["kind"], "nonvisual");
                }
                assert_eq!(
                    svg.descendants()
                        .find(|node| node.has_tag_name("title"))
                        .and_then(|node| node.text()),
                    Some("accTitle")
                );
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "journey-occurrences", &source).unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn journey_2_empty_and_inline_accessibility_statements_remain_exact_nonvisual_occurrences() {
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            let source = format!(
                "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n---\r\njourney\r\n%% 😀\r\ntitle First\r\ntitle \r\naccTitle: accTitle\r\naccTitle:\r\naccDescr {{ accDescr }}\r\naccDescr {{}}\r\nTask :5: Alice\r\n"
            );
            let result = mermaid_trace_rs::render("journey-empty", &source).unwrap();
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let native: Vec<Value> = serde_json::from_str(
                svg.descendants()
                    .find_map(|node| node.attribute("data-mt-native"))
                    .unwrap(),
            )
            .unwrap();
            let slice = |span: &Value| {
                &source[span["start"].as_u64().unwrap() as usize
                    ..span["end"].as_u64().unwrap() as usize]
            };
            let records: Vec<_> = native
                .iter()
                .filter(|piece| {
                    piece["origin"] == "body" || piece["classification"] == "accessibility"
                })
                .collect();
            assert_eq!(records.len(), 6);
            for (index, statement) in [
                "title First",
                "title",
                "accTitle: accTitle",
                "accTitle:",
                "accDescr { accDescr }",
                "accDescr {}",
            ]
            .iter()
            .enumerate()
            {
                assert_eq!(slice(&records[index]["span"]), *statement);
                assert_eq!(records[index]["kind"], "nonvisual");
                assert_eq!(records[index]["effective"], index % 2 == 1);
                if index % 2 == 1 {
                    assert!(records[index].get("labelSpan").is_none());
                }
            }
            assert_eq!(slice(&records[2]["labelSpan"]), "accTitle");
            assert_eq!(slice(&records[4]["labelSpan"]), "accDescr");
            assert!(
                result["mapping"]["pieces"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|piece| piece["domId"] != "journey:title" && piece["kind"] != "nonvisual")
            );
            assert!(
                !svg.descendants()
                    .any(|node| node.attribute("data-mt-key") == Some("journey:title"))
            );
        }
    }
    for source in [
        "journey\naccDescr {",
        "journey\naccDescr {\n  No closing 😀",
        "journey\r\naccDescr {\r\n  No closing 😀\r\n",
    ] {
        assert!(
            mermaid_trace_rs::render("journey-invalid", source).is_err(),
            "unterminated accessibility block must remain an explicit error"
        );
    }
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
