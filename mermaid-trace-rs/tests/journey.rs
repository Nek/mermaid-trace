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
fn journey_2_root_preserves_fixed_and_responsive_artifact_sizing() {
    use merman::{Engine, MermaidConfig, Renderer};
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for width in [0, 150] {
                for title in [false, true] {
                    let source = format!(
                        "journey\r\n{}section Day 😀\r\nTask 😀 : 5 : Alice\r\n",
                        if title { "title Root 😀\r\n" } else { "" }
                    );
                    let mut roots = Vec::new();
                    for max_width in [false, true] {
                        let config = |trace| {
                            MermaidConfig::from_value(json!({
                                "traceSource":trace,"look":look,"htmlLabels":html,
                                "journey":{"useMaxWidth":max_width,"width":width}
                            }))
                        };
                        let mapped = Renderer::new()
                            .with_engine(Engine::new().with_site_config(config(true)));
                        let plain = Renderer::new()
                            .with_engine(Engine::new().with_site_config(config(false)));
                        let result =
                            mermaid_trace_rs::render_with(&mapped, "journey-root", &source)
                                .unwrap();
                        let baseline =
                            mermaid_trace_rs::render_with(&plain, "journey-root", &source).unwrap();
                        assert_eq!(
                            support::strip_trace(result["svg"].as_str().unwrap()),
                            support::strip_trace(baseline["svg"].as_str().unwrap())
                        );
                        let document =
                            roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                        let root = document.root_element();
                        let emitted_width = root.attribute("width").unwrap();
                        assert_eq!(emitted_width == "100%", max_width);
                        if !max_width {
                            assert!(emitted_width.parse::<f64>().unwrap() > 0.0);
                        }
                        assert!(root.attribute("height").unwrap().parse::<f64>().unwrap() > 0.0);
                        assert_eq!(root.attribute("preserveAspectRatio"), Some("xMinYMin meet"));
                        let view_box = root.attribute("viewBox").unwrap().to_string();
                        let height = root.attribute("height").unwrap().to_string();
                        roots.push((view_box, height));
                        let pieces = result["mapping"]["pieces"].as_array().unwrap();
                        let section = pieces
                            .iter()
                            .find(|piece| piece["domId"] == "journey:section:0")
                            .unwrap();
                        assert_eq!(selected(&source, &section["labelSpan"]), "Day 😀");
                        let task = pieces
                            .iter()
                            .find(|piece| piece["domId"] == "journey:task:0")
                            .unwrap();
                        assert_eq!(selected(&source, &task["labelSpan"]), "Task 😀");
                    }
                    assert_eq!(
                        roots[0], roots[1],
                        "width mode only changes root width and max-width style"
                    );
                }
            }
        }
    }
}

#[test]
fn journey_2_palette_cycles_follow_effective_actor_and_section_identities() {
    use merman::{
        Engine, MermaidConfig, OperationControl, RenderOutput, RenderRequest, Renderer, SvgRequest,
    };
    let actor_colors = [
        "#112233", "#223344", "#334455", "#445566", "#556677", "#667788",
    ];
    let fills = [
        "#101112", "#202122", "#303132", "#404142", "#505152", "#606162", "#707172",
    ];
    let text_colors = [
        "#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777",
    ];
    let merged_actors = [
        "#8FBC8F", "#7CFC00", "#00FFFF", "#20B2AA", "#B0E0E6", "#FFFFE0",
    ]
    .into_iter()
    .chain(actor_colors)
    .collect::<Vec<_>>();
    let merged_fills = [
        "#191970", "#8B008B", "#4B0082", "#2F4F4F", "#800000", "#8B4513", "#00008B",
    ]
    .into_iter()
    .chain(fills)
    .collect::<Vec<_>>();
    let merged_text = ["#fff"].into_iter().chain(text_colors).collect::<Vec<_>>();
    let source = format!(
        "journey\r\n{}",
        (0..15)
            .map(|i| format!(
                "section S{i} 😀\r\nTask{i} : 5 : A, B, C, D, E, F, G, H, I, J, K, L, M\r\n"
            ))
            .collect::<String>()
    );
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            let config = |trace| {
                MermaidConfig::from_value(json!({
                    "traceSource":trace,"look":look,"htmlLabels":html,
                    "journey":{
                        "actorColours":actor_colors,"sectionFills":fills,
                        "sectionColours":text_colors,"textPlacement":"tspan"
                    }
                }))
            };
            let mapped = Renderer::new().with_engine(Engine::new().with_site_config(config(true)));
            let plain = Renderer::new().with_engine(Engine::new().with_site_config(config(false)));
            let RenderOutput::LayoutJson(Some(output)) = mapped
                .render(RenderRequest::layout_json(
                    &source,
                    OperationControl::new(),
                    SvgRequest::default(),
                ))
                .unwrap()
            else {
                panic!("Journey layout")
            };
            let layout = &output.layout()["layout"]["JourneyDiagram"];
            for (index, actor) in layout["actor_legend"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
            {
                assert_eq!(actor["color"], merged_actors[index % merged_actors.len()]);
            }
            for (index, section) in layout["sections"].as_array().unwrap().iter().enumerate() {
                assert_eq!(section["fill"], merged_fills[index % merged_fills.len()]);
                assert_eq!(section["num"], json!(index % merged_fills.len()));
            }
            let result =
                mermaid_trace_rs::render_with(&mapped, "journey-palette", &source).unwrap();
            let baseline =
                mermaid_trace_rs::render_with(&plain, "journey-palette", &source).unwrap();
            assert_eq!(
                support::strip_trace(result["svg"].as_str().unwrap()),
                support::strip_trace(baseline["svg"].as_str().unwrap())
            );
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            for (index, section) in svg
                .descendants()
                .filter(|n| {
                    n.has_tag_name("rect")
                        && n.attribute("class")
                            .is_some_and(|class| class.contains("journey-section"))
                })
                .enumerate()
            {
                assert_eq!(
                    section.attribute("fill"),
                    Some(merged_fills[index % merged_fills.len()])
                );
            }
            for (index, task) in svg
                .descendants()
                .filter(|n| n.has_tag_name("text") && n.attribute("class") == Some("task"))
                .enumerate()
            {
                assert_eq!(
                    task.attribute("fill"),
                    Some(merged_text[index % merged_text.len()])
                );
            }
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            for index in 0..15 {
                let section = pieces
                    .iter()
                    .find(|piece| piece["domId"] == format!("journey:section:{index}"))
                    .unwrap();
                assert_eq!(
                    selected(&source, &section["labelSpan"]),
                    format!("S{index} 😀")
                );
                let task = pieces
                    .iter()
                    .find(|piece| piece["domId"] == format!("journey:task:{index}"))
                    .unwrap();
                assert_eq!(
                    selected(&source, &task["labelSpan"]),
                    format!("Task{index}")
                );
            }
        }
    }
}

#[test]
fn journey_2_fonts_keep_native_values_visible_text_and_exact_ownership() {
    let renderer = mermaid_trace_rs::renderer();
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for mode in ["tspan", "fo", "old"] {
                for (size, css, offsets) in [
                    ("0", "0px", ["0", "0"]),
                    ("0.5", "0.5px", ["-0.25", "0.25"]),
                    ("24", "24px", ["-12", "12"]),
                    ("'24'", "24", ["-12", "12"]),
                    ("'24px'", "24px", ["0", "0"]),
                    ("'1em'", "1em", ["0", "0"]),
                    ("'120%'", "120%", ["0", "0"]),
                    ("-1", "-1px", ["0.5", "-0.5"]),
                    ("'garbage'", "garbage", ["0", "0"]),
                ] {
                    let source = format!(
                        "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n  fontFamily: Georgia\r\n  themeVariables:\r\n    fontSize: 20px\r\n  journey:\r\n    taskFontSize: {size}\r\n    taskFontFamily: Courier\r\n    titleFontSize: 22\r\n    titleFontFamily: Verdana\r\n    titleColor: '#123456'\r\n    textPlacement: {mode}\r\n---\r\njourney\r\ntitle Font title\r\nsection Day\r\nFirst<br>Second : 5 : Author\r\n"
                    );
                    let result =
                        mermaid_trace_rs::render_with(&renderer, "journey-fonts", &source).unwrap();
                    let plain = mermaid_trace_rs::render_with(
                        &merman::Renderer::new(),
                        "journey-fonts",
                        &source,
                    )
                    .unwrap();
                    assert_eq!(
                        support::strip_trace(result["svg"].as_str().unwrap()),
                        support::strip_trace(plain["svg"].as_str().unwrap())
                    );
                    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                    let task_lines = svg
                        .descendants()
                        .filter(|node| {
                            node.has_tag_name("text") && node.attribute("class") == Some("task")
                        })
                        .collect::<Vec<_>>();
                    assert_eq!(
                        task_lines.len(),
                        if mode == "old" { 1 } else { 2 },
                        "safe SVG retains authored text for {size} {mode}"
                    );
                    if mode != "old" {
                        let computed_css = task_lines[0].attribute("style").unwrap();
                        assert!(
                            computed_css.contains(&format!("font-size:{css}")),
                            "{computed_css}"
                        );
                        assert!(computed_css.contains("font-family:Courier"));
                        for (line, dy) in task_lines.iter().zip(offsets) {
                            assert_eq!(
                                line.descendants()
                                    .find(|node| node.has_tag_name("tspan"))
                                    .unwrap()
                                    .attribute("dy"),
                                Some(dy)
                            );
                        }
                    } else {
                        assert!(
                            !task_lines[0]
                                .attribute("style")
                                .unwrap()
                                .contains("font-size:")
                        );
                    }
                    let title = svg
                        .descendants()
                        .find(|node| node.has_tag_name("text") && node.text() == Some("Font title"))
                        .unwrap();
                    assert_eq!(title.attribute("font-size"), Some("22"));
                    assert_eq!(title.attribute("font-family"), Some("Verdana"));
                    assert_eq!(title.attribute("fill"), Some("#123456"));
                    let pieces = result["mapping"]["pieces"].as_array().unwrap();
                    let task = pieces
                        .iter()
                        .find(|piece| piece["domId"] == "journey:task:0")
                        .unwrap();
                    assert_eq!(selected(&source, &task["labelSpan"]), "First<br>Second");
                    let visual_labels = svg
                        .descendants()
                        .filter(|node| {
                            node.attribute("data-mt-role") == Some("node-label")
                                && node.attribute("data-mt-key") == Some("journey:task:0")
                        })
                        .count();
                    assert_eq!(
                        visual_labels, 1,
                        "static provenance remains available even when CSS hides the label"
                    );
                }
            }
        }
    }
}

#[test]
fn journey_2_actor_unicode_preserves_js_names_order_and_source_ownership() {
    use merman::{Engine, ParseOptions, RenderSemanticModel};
    let engine = Engine::new();
    let renderer = mermaid_trace_rs::renderer();
    let whitespace = [
        '\t', '\u{000b}', '\u{000c}', ' ', '\u{00a0}', '\u{1680}', '\u{2000}', '\u{2001}',
        '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}',
        '\u{2009}', '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}',
        '\u{feff}',
    ];
    let people = [
        "Alpha",
        "Alpha",
        "\u{0085}Alpha\u{0085}",
        "😀",
        "\u{e000}",
        "😀",
        "",
    ];
    let actors = ["", "Alpha", "\u{0085}Alpha\u{0085}", "😀", "\u{e000}"];
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for ws in whitespace {
                let source = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n---\r\njourney\r\n%% 😀\r\nFirst : 5 : {ws}Alpha{ws}, Alpha, \u{0085}Alpha\u{0085}, \u{feff}😀\u{feff}, \u{e000}, 😀, {ws}\r\nSecond : 3 : Alpha, 😀\r\n"
                );
                let parsed = engine
                    .parse_diagram_for_render_model_sync(&source, ParseOptions::strict())
                    .unwrap()
                    .unwrap();
                let RenderSemanticModel::Journey(model) = parsed.model() else {
                    panic!("journey model")
                };
                assert_eq!(
                    model.tasks[0].people, people,
                    "ECMAScript trimming for {ws:?}"
                );
                assert_eq!(model.actors, actors, "unique names sort by UTF-16 units");
                let RenderOutput::LayoutJson(Some(output)) = renderer
                    .render(RenderRequest::layout_json(
                        &source,
                        OperationControl::new(),
                        SvgRequest::default(),
                    ))
                    .unwrap()
                else {
                    panic!("journey layout")
                };
                let layout = &output.layout()["layout"]["JourneyDiagram"];
                let legend = layout["actor_legend"].as_array().unwrap();
                assert_eq!(
                    legend
                        .iter()
                        .map(|a| a["actor"].as_str().unwrap())
                        .collect::<Vec<_>>(),
                    actors
                );
                for (pos, item) in legend.iter().enumerate() {
                    assert_eq!(item["pos"], json!(pos));
                    assert_eq!(
                        item["color"],
                        ["#8FBC8F", "#7CFC00", "#00FFFF", "#20B2AA", "#B0E0E6"][pos]
                    );
                }
                for (slot, actor) in people.iter().enumerate() {
                    let circle = &layout["tasks"][0]["actor_circles"][slot];
                    let pos = actors.iter().position(|name| name == actor).unwrap();
                    assert_eq!(circle["actor"], *actor);
                    assert_eq!(circle["pos"], json!(pos));
                    assert_eq!(circle["color"], legend[pos]["color"]);
                }
                let result =
                    mermaid_trace_rs::render_with(&renderer, "unicode-actors", &source).unwrap();
                let plain = mermaid_trace_rs::render_with(
                    &merman::Renderer::new(),
                    "unicode-actors",
                    &source,
                )
                .unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(plain["svg"].as_str().unwrap())
                );
                let pieces = result["mapping"]["pieces"].as_array().unwrap();
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let mut offset = source.find("First : 5 : ").unwrap() + "First : 5 : ".len();
                for (slot, actor) in people.iter().enumerate() {
                    let key = format!("journey:actor:0:{slot}");
                    let found = pieces
                        .iter()
                        .filter(|p| p["domId"] == key)
                        .collect::<Vec<_>>();
                    if actor.is_empty() {
                        assert!(found.is_empty());
                    } else {
                        let byte = offset + source[offset..].find(actor).unwrap();
                        let start = source[..byte].encode_utf16().count();
                        assert_eq!(found.len(), 1);
                        assert_eq!(
                            found[0]["span"],
                            json!({"start":start,"end":start+actor.encode_utf16().count()})
                        );
                        assert_eq!(selected(&source, &found[0]["span"]), *actor);
                        assert_eq!(found[0]["target"], *actor);
                        assert_eq!(
                            svg.descendants()
                                .filter(|n| n.attribute("data-mt-key") == Some(key.as_str()))
                                .count(),
                            1
                        );
                        let declaration = pieces
                            .iter()
                            .find(|p| p["domId"] == format!("journey:actor:{actor}"))
                            .unwrap();
                        if [0, 2, 3, 4].contains(&slot) {
                            assert_eq!(declaration["span"], found[0]["span"]);
                        } else {
                            assert_ne!(declaration["span"], found[0]["span"]);
                        }
                    }
                    if slot < people.len() - 1 {
                        offset += source[offset..].find(',').unwrap() + 1;
                    }
                }
                assert!(!pieces.iter().any(|p| p["domId"] == "journey:actor:"));
            }
        }
    }
    for (raw, actor, statement) in [
        (
            "\u{0085}Alpha\u{0085}",
            "\u{0085}Alpha\u{0085}",
            "Task : 5 : \u{0085}Alpha\u{0085}",
        ),
        ("\u{feff}Alpha\u{feff}", "Alpha", "Task : 5 : \u{feff}Alpha"),
    ] {
        let source = format!("journey\r\nTask : 5 : {raw}\r\n");
        let result = mermaid_trace_rs::render_with(&renderer, "terminal-actor", &source).unwrap();
        let pieces = result["mapping"]["pieces"].as_array().unwrap();
        for (id, expected) in [("journey:task:0", statement), ("journey:actor:0:0", actor)] {
            let piece = pieces.iter().find(|p| p["domId"] == id).unwrap();
            assert_eq!(
                selected(&source, &piece["span"]),
                expected,
                "terminal whitespace preserves exact original CRLF ownership"
            );
        }
    }
}

#[test]
fn journey_2_legend_empty_actor_retains_generated_geometry_without_invented_labels() {
    let renderer = mermaid_trace_rs::renderer();
    let source = "---\r\nconfig:\r\n  journey:\r\n    maxLabelWidth: -1\r\n---\r\njourney\r\nFirst : 5 :\r\n";
    let RenderOutput::LayoutJson(Some(output)) = renderer
        .render(RenderRequest::layout_json(
            source,
            OperationControl::new(),
            SvgRequest::default(),
        ))
        .unwrap()
    else {
        panic!("journey layout")
    };
    let layout = &output.layout()["layout"]["JourneyDiagram"];
    assert_eq!(
        layout["actor_legend"][0]["label_lines"],
        json!([]),
        "the pinned wrapper emits no label for an empty actor at negative width"
    );
    let result = mermaid_trace_rs::render_with(&renderer, "empty-legend", source).unwrap();
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    assert_eq!(
        svg.descendants()
            .filter(|n| n.has_tag_name("text") && n.attribute("class") == Some("legend"))
            .count(),
        0
    );
    assert_eq!(
        svg.descendants()
            .filter(|n| n.has_tag_name("circle") && n.attribute("class") == Some("actor-0"))
            .count(),
        2,
        "generated legend and task circles remain"
    );
    assert!(
        !result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["relation"] == "actor-reference" || p["domId"] == "journey:actor:"),
        "empty actor slots acquire no invented source range"
    );
}

#[test]
fn journey_2_legend_preserves_narrow_wrapping_and_actor_ownership() {
    let renderer = mermaid_trace_rs::renderer();
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            let mut font_widths = Vec::new();
            for (limit, margin, font, actor, expected) in [
                (0, 0, 16, "Alpha", vec!["-", "A-", "l-", "p-", "h-", "a"]),
                (-1, 0, 16, "Alpha", vec!["-", "A-", "l-", "p-", "h-", "a"]),
                (1, 0, 16, "Alpha", vec!["-", "A-", "l-", "p-", "h-", "a"]),
                (360, 0, 16, "Alpha", vec!["Alpha"]),
                (0, 0, 1, ".", vec!["-", "."]),
                (
                    0,
                    9,
                    24,
                    "Al pha",
                    vec!["-", "A-", "l", "-", "p-", "h-", "a"],
                ),
                (360, 9, 12, "Alpha 😀", vec!["Alpha 😀"]),
                (0, 0, 16, "A😀", vec!["-", "A�-", "😀"]),
                (360, 0, 12, "Alpha", vec!["Alpha"]),
                (360, 0, 24, "Alpha", vec!["Alpha"]),
            ] {
                let source = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n  fontFamily: Arial\r\n  themeVariables:\r\n    fontSize: {font}px\r\n  journey:\r\n    maxLabelWidth: {limit}\r\n    boxTextMargin: {margin}\r\n    leftMargin: 0\r\n---\r\njourney\r\n%% 😀\r\nFirst : 5 : {actor}\r\nSecond : 3 : {actor}\r\n"
                );
                let RenderOutput::LayoutJson(Some(output)) = renderer
                    .render(RenderRequest::layout_json(
                        &source,
                        OperationControl::new(),
                        SvgRequest::default(),
                    ))
                    .unwrap()
                else {
                    panic!("journey layout")
                };
                let layout = &output.layout()["layout"]["JourneyDiagram"];
                let lines = layout["actor_legend"][0]["label_lines"].as_array().unwrap();
                assert_eq!(
                    lines
                        .iter()
                        .map(|line| line["text"].as_str().unwrap())
                        .collect::<Vec<_>>(),
                    expected,
                    "pinned narrow wrapping: {limit}"
                );
                for (i, line) in lines.iter().enumerate() {
                    assert_eq!(line["tspan_x"], json!(40.0 + 2.0 * margin as f64));
                    assert_eq!(line["y"], json!(67.0 + i as f64 * 20.0));
                }
                if limit == 360 && margin == 0 && actor == "Alpha" && font != 16 {
                    font_widths.push(layout["max_actor_label_width"].as_f64().unwrap());
                }
                let plain = merman::Renderer::new();
                let result =
                    mermaid_trace_rs::render_with(&renderer, "journey-legend", &source).unwrap();
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "journey-legend", &source).unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(baseline["svg"].as_str().unwrap())
                );
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let labels = svg
                    .descendants()
                    .filter(|n| n.has_tag_name("text") && n.attribute("class") == Some("legend"))
                    .collect::<Vec<_>>();
                assert_eq!(labels.len(), expected.len());
                for (label, text) in labels.iter().zip(&expected) {
                    assert_eq!(
                        label
                            .descendants()
                            .find(|n| n.has_tag_name("tspan"))
                            .unwrap()
                            .text(),
                        Some(*text)
                    );
                    assert_eq!(
                        label.attribute("data-mt-key"),
                        Some(format!("journey:actor:{actor}").as_str())
                    );
                }
                let pieces = result["mapping"]["pieces"].as_array().unwrap();
                let declaration = pieces
                    .iter()
                    .find(|p| p["domId"] == format!("journey:actor:{actor}"))
                    .unwrap();
                assert_eq!(selected(&source, &declaration["span"]), actor);
                let first = pieces
                    .iter()
                    .find(|p| p["domId"] == "journey:actor:0:0")
                    .unwrap();
                let later = pieces
                    .iter()
                    .find(|p| p["domId"] == "journey:actor:1:0")
                    .unwrap();
                assert_eq!(first["span"], declaration["span"]);
                assert_ne!(later["span"], declaration["span"]);
            }
            assert_eq!(font_widths.len(), 2);
            assert!(
                font_widths[1] > font_widths[0],
                "larger effective legend fonts increase the native measured margin"
            );
        }
    }
}

#[test]
fn journey_2_geometry_config_preserves_zero_dimensions_and_signed_spacing() {
    let renderer = mermaid_trace_rs::renderer();
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(
        merman::MermaidConfig::from_value(json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"})),
    ));
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for (width, height, spacing, mx, my, left) in [
                (0.0, 50.0, 50.0, 50.0, 10.0, 150.0),
                (150.0, 0.0, 50.0, 50.0, 10.0, 150.0),
                (150.0, 50.0, -25.5, 50.0, 10.0, 150.0),
                (0.0, 0.0, 70.0, 20.0, 0.0, 80.0),
                (200.0, 80.0, -10.5, 30.0, 20.0, 100.0),
                (160.0, 40.0, 0.0, 0.0, 0.0, 0.0),
                (150.0, 50.0, -75.0, 50.0, 10.0, 150.0),
                (150.0, 50.0, -250.0, 50.0, 10.0, 150.0),
                (150.0, 300.0, 50.0, 50.0, 10.0, 150.0),
                (150.0, 50.0, 50.0, 50.0, 500.0, 150.0),
            ] {
                let source = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n  journey:\r\n    width: {width}\r\n    height: {height}\r\n    taskMargin: {spacing}\r\n    diagramMarginX: {mx}\r\n    diagramMarginY: {my}\r\n    leftMargin: {left}\r\n---\r\njourney\r\nsection S 😀\r\nFirst : 5\r\nSecond : 3\r\nsection T\r\nThird : 1\r\n"
                );
                let RenderOutput::LayoutJson(Some(output)) = renderer
                    .render(RenderRequest::layout_json(
                        &source,
                        OperationControl::new(),
                        SvgRequest::default(),
                    ))
                    .unwrap()
                else {
                    panic!("journey layout")
                };
                let layout = &output.layout()["layout"]["JourneyDiagram"];
                assert_eq!(
                    layout["left_margin"],
                    json!(left),
                    "no actor legend changes margin"
                );
                for (index, task) in layout["tasks"].as_array().unwrap().iter().enumerate() {
                    assert_eq!(task["width"], json!(width), "configured width: {source}");
                    assert_eq!(task["height"], json!(height), "configured height: {source}");
                    assert_eq!(task["x"], json!(left + index as f64 * (width + spacing)));
                    assert_eq!(task["y"], json!(2.0 * height + my));
                    assert_eq!(
                        task["face_cx"],
                        json!(left + index as f64 * (width + spacing) + width / 2.0)
                    );
                }
                assert_eq!(layout["sections"][0]["width"], json!(2.0 * width + mx));
                assert_eq!(layout["sections"][1]["width"], json!(width));
                assert_eq!(layout["activity_line"]["y1"], json!(4.0 * height));
                let startx = (0..3)
                    .map(|index| {
                        let x = left + index as f64 * (width + spacing);
                        x.min(x + mx + spacing)
                    })
                    .fold(0.0, f64::min);
                let stopx = (0..3)
                    .map(|index| {
                        let x = left + index as f64 * (width + spacing);
                        x.max(x + mx + spacing)
                    })
                    .fold(left, f64::max);
                assert_eq!(layout["width"], json!(left + stopx + 2.0 * mx));
                assert_eq!(layout["bounds"]["min_x"], json!(startx));
                assert_eq!(
                    layout["bounds"]["max_x"],
                    json!(startx + left + stopx + 2.0 * mx)
                );
                assert_eq!(
                    layout["height"],
                    json!(450.0_f64.max(2.0 * height + my) + 2.0 * my)
                );
                let result =
                    mermaid_trace_rs::render_with(&renderer, "journey-geometry", &source).unwrap();
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "journey-geometry", &source).unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(baseline["svg"].as_str().unwrap())
                );
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let mut request = SvgRequest::default();
                request.pipeline = Some(merman::svg::SvgPipeline::parity());
                let RenderOutput::Svg(Some(raw)) = renderer
                    .render(RenderRequest::svg(
                        &source,
                        OperationControl::new(),
                        request,
                    ))
                    .unwrap()
                else {
                    panic!("raw journey SVG")
                };
                let raw_svg = roxmltree::Document::parse(raw.svg()).unwrap();
                let viewbox: Vec<f64> = raw_svg
                    .root_element()
                    .attribute("viewBox")
                    .unwrap()
                    .split_whitespace()
                    .map(|value| value.parse().unwrap())
                    .collect();
                assert_eq!(viewbox[0], startx);
                assert_eq!(viewbox[2], left + stopx + 2.0 * mx);
                assert_eq!(viewbox[3], 450.0_f64.max(2.0 * height + my) + 2.0 * my);
                assert_eq!(
                    svg.descendants()
                        .filter(|n| n.has_tag_name("rect")
                            && n.attribute("class")
                                .is_some_and(|c| c.starts_with("task task-type-")))
                        .count(),
                    if width == 0.0 || height == 0.0 { 0 } else { 3 },
                    "safe export must not invent a zero-area body"
                );
                for (index, name) in ["First", "Second", "Third"].iter().enumerate() {
                    let key = format!("journey:task:{index}");
                    assert!(
                        svg.descendants()
                            .any(|n| n.attribute("data-mt-key") == Some(key.as_str())
                                && n.attribute("data-mt-role") == Some("node")),
                        "native task body identity"
                    );
                    let rect = raw_svg
                        .descendants()
                        .filter(|n| {
                            n.has_tag_name("rect")
                                && n.attribute("class")
                                    .is_some_and(|c| c.starts_with("task task-type-"))
                        })
                        .nth(index)
                        .expect("raw task rectangle");
                    assert_eq!(
                        rect.attribute("width").unwrap().parse::<f64>().unwrap(),
                        width
                    );
                    assert_eq!(
                        rect.attribute("height").unwrap().parse::<f64>().unwrap(),
                        height
                    );
                    let label = result["mapping"]["pieces"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|p| p["domId"] == key && p.get("labelSpan").is_some())
                        .expect("visible label remains mapped");
                    assert_eq!(selected(&source, &label["labelSpan"]), *name);
                }
            }
        }
    }
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
