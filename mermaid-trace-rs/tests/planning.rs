mod support;
use serde_json::Value;

const GANTT: &str = "---\r\nconfig:\r\n  theme: default\r\n---\r\ngantt\r\n  title Plan 😀\r\n  dateFormat YYYY-MM-DD\r\n  todayMarker off\r\n  section Build\r\n  Same 😀 :done, a, 2026-01-01, 2d\r\n  Same 😀 :crit, b, after a, 1d\r\n  Ship :milestone, c, after b, 0d\r\n";

#[test]
fn own_gantt_dependency_tokens_keep_task_owner_and_constraint_relationship() {
    let source = "gantt\r\n  dateFormat YYYY-MM-DD\r\n  Base 😀 :base, 2026-01-01, 1d\r\n  Peer :peer, 2026-01-02, 1d\r\n  Window :win, 2026-01-05, 1d\r\n  Base 😀 :done, b, after base base peer, until win\r\n";
    let result = mermaid_trace_rs::render("gantt-dependencies", source).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let utf16: Vec<_> = source.encode_utf16().collect();
    let selected = |piece: &Value| {
        String::from_utf16(
            &utf16[piece["span"]["start"].as_u64().unwrap() as usize
                ..piece["span"]["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let dependencies = pieces
        .iter()
        .filter(|piece| piece["relation"] == "dependency-reference")
        .collect::<Vec<_>>();
    assert_eq!(
        dependencies
            .iter()
            .map(|piece| (
                selected(piece),
                piece["target"].as_str().unwrap(),
                piece["constraint"].as_str().unwrap()
            ))
            .collect::<Vec<_>>(),
        [
            ("base".into(), "base", "after"),
            ("base".into(), "base", "after"),
            ("peer".into(), "peer", "after"),
            ("win".into(), "win", "until")
        ]
    );
    assert!(
        dependencies
            .iter()
            .all(|piece| piece["domId"] == "gantt:task:b" && piece["semanticId"] == "b")
    );
    let task = pieces
        .iter()
        .find(|piece| piece["domId"] == "gantt:task:b" && piece["relation"].is_null())
        .unwrap();
    assert_eq!(
        selected(task),
        "Base 😀 :done, b, after base base peer, until win"
    );
    assert_eq!(
        dependencies[0]["span"]["end"].as_u64().unwrap(),
        dependencies[1]["span"]["start"].as_u64().unwrap() - 1
    );
}

#[test]
fn gantt_plan_ac1_2_native_tasks_labels_sections_and_title() {
    let result = mermaid_trace_rs::render("planning-gantt", GANTT).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let utf16: Vec<_> = GANTT.encode_utf16().collect();
    let slice = |span: &Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let nodes: Vec<_> = pieces
        .iter()
        .filter(|p| p["kind"] == "node" && p["relation"].is_null())
        .collect();
    assert_eq!(
        nodes.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
        [
            "Same 😀 :done, a, 2026-01-01, 2d",
            "Same 😀 :crit, b, after a, 1d",
            "Ship :milestone, c, after b, 0d"
        ]
    );
    assert_eq!(
        nodes
            .iter()
            .map(|p| slice(&p["labelSpan"]))
            .collect::<Vec<_>>(),
        ["Same 😀", "Same 😀", "Ship"]
    );
    assert_ne!(nodes[0]["domId"], nodes[1]["domId"]);
    assert!(pieces.iter().any(|p| slice(&p["span"]) == "section Build"));
    assert!(pieces.iter().any(|p| slice(&p["labelSpan"]) == "Plan 😀"));
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    assert!(
        svg.descendants()
            .any(|n| n.has_tag_name("rect") && n.attribute("data-mt-role") == Some("node"))
    );
    assert!(
        svg.descendants()
            .any(|n| n.has_tag_name("text") && n.attribute("data-mt-role") == Some("node-label"))
    );
    assert_eq!(
        result,
        mermaid_trace_rs::render("planning-gantt", GANTT).unwrap()
    );
}

#[test]
fn gantt_plan_ac2_provenance_keeps_plain_native_svg_unchanged() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let mapped = mermaid_trace_rs::render("planning-plain", GANTT).unwrap();
    let baseline = mermaid_trace_rs::render_with(&plain, "planning-plain", GANTT).unwrap();
    assert_eq!(
        support::strip_trace(mapped["svg"].as_str().unwrap()),
        support::strip_trace(baseline["svg"].as_str().unwrap())
    );
}

const JOURNEY: &str = "journey\r\n%% 😀\r\n  title Trip 😀\r\n  section Morning\r\n  Same 😀 : 5 : Alice, Bob\r\n  Same 😀 : 2 : Alice\r\n  section Evening\r\n  Rest : 3 : Bob\r\n";

#[test]
fn journey_plan_ac1_2_tasks_scores_people_and_sections_keep_original_spans() {
    let result = mermaid_trace_rs::render("planning-journey", JOURNEY).unwrap();
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let utf16: Vec<_> = JOURNEY.encode_utf16().collect();
    let slice = |span: &Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let tasks: Vec<_> = pieces.iter().filter(|p| p["kind"] == "node").collect();
    assert_eq!(
        tasks.iter().map(|p| slice(&p["span"])).collect::<Vec<_>>(),
        [
            "Same 😀 : 5 : Alice, Bob",
            "Same 😀 : 2 : Alice",
            "Rest : 3 : Bob"
        ]
    );
    assert_eq!(
        tasks
            .iter()
            .map(|p| slice(&p["labelSpan"]))
            .collect::<Vec<_>>(),
        ["Same 😀", "Same 😀", "Rest"]
    );
    assert_ne!(tasks[0]["domId"], tasks[1]["domId"]);
    assert!(
        pieces
            .iter()
            .any(|p| p["domId"] == "journey:score:0" && slice(&p["span"]) == "5")
    );
    assert!(
        pieces
            .iter()
            .any(|p| p["domId"] == "journey:actor:1:0" && slice(&p["span"]) == "Alice")
    );
    assert_eq!(
        pieces
            .iter()
            .filter(|p| p["domId"] == "journey:actor:Alice")
            .count(),
        1
    );
    assert!(
        pieces
            .iter()
            .any(|p| slice(&p["span"]) == "section Evening")
    );
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let baseline = mermaid_trace_rs::render_with(&plain, "planning-journey", JOURNEY).unwrap();
    assert_eq!(
        support::strip_trace(result["svg"].as_str().unwrap()),
        support::strip_trace(baseline["svg"].as_str().unwrap())
    );
}

const KANBAN: &str = "---\r\nconfig:\r\n  theme: default\r\n---\r\nkanban\r\n%% 😀\r\n  todo[Todo]\r\n    a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }\r\n    b[Same 😀]\r\n  done[Done]\r\n    c[Ship]\r\n";

#[test]
fn own_journey_section_runs_preserve_declarations_aliases_and_nonvisual_origins() {
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for (body, bindings) in [
                (
                    "section Day 😀\r\nFirst : 5 : Alice\r\nsection Night\r\nSecond : 2 : Bob\r\nsection Day 😀\r\nThird : 3 : Carol\r\n",
                    vec![Some(0), Some(1), Some(2)],
                ),
                (
                    "section Day 😀\r\nFirst : 5 : Alice\r\nsection Day 😀\r\nSecond : 2 : Bob\r\n",
                    vec![Some(0), Some(0)],
                ),
                (
                    "section Unused\r\nsection Day 😀\r\nFirst : 5 : Alice\r\n",
                    vec![None, Some(1)],
                ),
                ("section \r\nFirst : 5 : Alice\r\n", vec![None]),
                (
                    "First : 5 : Alice\r\nsection Day 😀\r\nSecond : 2 : Bob\r\n",
                    vec![Some(0)],
                ),
                (
                    "section Day 😀\r\nFirst : 5 : Alice\r\nsection Unused\r\nsection Day 😀\r\nSecond : 2 : Bob\r\n",
                    vec![Some(0), None, Some(0)],
                ),
                (
                    "section Day 😀\r\nFirst : 5 : Alice\r\nsection \r\nSecond : 2 : Bob\r\nsection Day 😀\r\nThird : 3 : Carol\r\n",
                    vec![Some(0), Some(1), Some(2)],
                ),
                (
                    "section Day 😀\r\nsection Day 😀\r\nFirst : 5 : Alice\r\n",
                    vec![None, Some(1)],
                ),
            ] {
                let source = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n---\r\njourney\r\n%% 😀\r\n{body}"
                );
                let result = mermaid_trace_rs::render("section-owner", &source).unwrap();
                let pieces = result["mapping"]["pieces"].as_array().unwrap();
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                let native: Vec<Value> = serde_json::from_str(
                    svg.descendants()
                        .find_map(|n| n.attribute("data-mt-native"))
                        .unwrap(),
                )
                .unwrap();
                let mut byte = source.find(body).unwrap();
                let mut index = 0;
                for line in body.split_inclusive('\n') {
                    if line.starts_with("section ") {
                        let span = serde_json::json!({"start":source[..byte].encode_utf16().count(),"end":source[..byte+line.trim_end().len()].encode_utf16().count()});
                        let authored = native
                            .iter()
                            .find(|p| p["sectionIndex"] == index)
                            .expect("every native section declaration retains its occurrence");
                        assert_eq!(authored["sectionIndex"], index);
                        match bindings[index] {
                            Some(owner) => {
                                assert_eq!(authored["semanticId"], format!("section:{owner}"));
                                assert_eq!(authored["domId"], format!("journey:section:{owner}"));
                                assert_eq!(authored["effective"], index == owner);
                                let piece =
                                    pieces.iter().find(|p| p["sectionIndex"] == index).unwrap();
                                assert_eq!(piece["span"], span);
                                let visuals: Vec<_> = svg
                                    .descendants()
                                    .filter(|n| {
                                        n.attribute("data-mt-key") == authored["domId"].as_str()
                                            && n.attribute("data-mt-role") == Some("control")
                                    })
                                    .collect();
                                assert_eq!(
                                    visuals.len(),
                                    1,
                                    "one distinct frame per native section run: {source}"
                                );
                                if index == owner {
                                    assert_eq!(
                                        visuals[0]
                                            .attribute("data-mt-start")
                                            .unwrap()
                                            .parse::<usize>()
                                            .unwrap(),
                                        span["start"].as_u64().unwrap() as usize
                                    );
                                    let label =
                                        line.trim_end().strip_prefix("section").unwrap().trim();
                                    if label.is_empty() {
                                        assert!(piece.get("labelSpan").is_none());
                                    } else {
                                        let start = source[..byte + line.find(label).unwrap()]
                                            .encode_utf16()
                                            .count();
                                        assert_eq!(
                                            piece["labelSpan"],
                                            serde_json::json!({"start":start,"end":start+label.encode_utf16().count()})
                                        );
                                    }
                                }
                            }
                            None => {
                                assert_eq!(authored["kind"], "nonvisual");
                                assert_eq!(authored["classification"], "unused-section");
                                assert!(!pieces.iter().any(|p| p["sectionIndex"] == index));
                                assert!(!svg.descendants().any(|n| n.attribute("data-mt-key")
                                    == Some(format!("journey:section:{index}").as_str())));
                            }
                        }
                        index += 1;
                    }
                    byte += line.len();
                }
                assert_eq!(index, bindings.len());
                let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "section-owner", &source).unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn own_journey_actor_slots_keep_references_local_and_first_legend_origin() {
    for look in ["classic", "neo", "handDrawn"] {
        for html in [false, true] {
            for section_mode in [0, 1, 2, 3] {
                let source = format!(
                    "---\r\nconfig:\r\n  look: {look}\r\n  htmlLabels: {html}\r\n---\r\njourney\r\n%% 😀\r\n{}First : 5 : Alice 😀, Alice 😀, , Bob, Alice 😀\r\n{}Second : 2 : Alice 😀, Bob, Carol : Ignored\r\nThird : 3 : Carol\r\n",
                    if section_mode == 0 || section_mode == 3 {
                        ""
                    } else {
                        "section Day\r\n"
                    },
                    if section_mode >= 2 {
                        "section Day\r\n"
                    } else {
                        ""
                    }
                );
                let result = mermaid_trace_rs::render("journey-owner", &source).unwrap();
                let pieces = result["mapping"]["pieces"].as_array().unwrap();
                let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
                for actor in ["Alice 😀", "Bob", "Carol"] {
                    let legends: Vec<_> = pieces
                        .iter()
                        .filter(|p| p["domId"] == format!("journey:actor:{actor}"))
                        .collect();
                    assert_eq!(
                        legends.len(),
                        1,
                        "legend owns only its first genuine declaration: {source}"
                    );
                    let start = source[..source.find(actor).unwrap()].encode_utf16().count();
                    assert_eq!(
                        legends[0]["span"],
                        serde_json::json!({"start":start,"end":start+actor.encode_utf16().count()})
                    );
                }
                for (task, statement, actors) in [
                    (
                        0,
                        "First : 5 : Alice 😀, Alice 😀, , Bob, Alice 😀",
                        vec!["Alice 😀", "Alice 😀", "", "Bob", "Alice 😀"],
                    ),
                    (
                        1,
                        "Second : 2 : Alice 😀, Bob, Carol : Ignored",
                        vec!["Alice 😀", "Bob", "Carol"],
                    ),
                    (2, "Third : 3 : Carol", vec!["Carol"]),
                ] {
                    let mut offset =
                        source.find(statement).unwrap() + statement.find(" : ").unwrap() + 3;
                    offset += source[offset..].find(':').unwrap() + 1;
                    for (slot, actor) in actors.iter().enumerate() {
                        let key = format!("journey:actor:{task}:{slot}");
                        let local: Vec<_> = pieces.iter().filter(|p| p["domId"] == key).collect();
                        if actor.is_empty() {
                            assert!(
                                local.is_empty(),
                                "empty slots have no fabricated source token"
                            );
                        } else {
                            let token = offset + source[offset..].find(actor).unwrap();
                            let start = source[..token].encode_utf16().count();
                            assert_eq!(
                                local.len(),
                                1,
                                "one exact owner per native task property slot"
                            );
                            assert_eq!(
                                local[0]["span"],
                                serde_json::json!({"start":start,"end":start+actor.encode_utf16().count()})
                            );
                            assert_eq!(local[0]["relation"], "actor-reference");
                            assert_eq!(local[0]["target"], *actor);
                            assert_eq!(local[0]["parentId"], format!("task:{task}"));
                            assert_eq!(local[0]["index"], slot);
                            assert_eq!(
                                svg.descendants()
                                    .filter(|n| n.attribute("data-mt-key") == Some(key.as_str()))
                                    .count(),
                                1
                            );
                        }
                        if let Some(comma) = source[offset..].find(',') {
                            offset += comma + 1;
                        }
                    }
                }
                assert!(
                    !pieces
                        .iter()
                        .any(|p| p["semanticId"] == "Ignored" || p["target"] == "Ignored")
                );
                let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
                let baseline =
                    mermaid_trace_rs::render_with(&plain, "journey-owner", &source).unwrap();
                assert_eq!(
                    support::strip_trace(result["svg"].as_str().unwrap()),
                    support::strip_trace(baseline["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn kanban_plan_ac1_2_columns_cards_metadata_and_relations_have_exact_spans() {
    let result = mermaid_trace_rs::render("planning-kanban", KANBAN).unwrap();
    let document = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    assert!(
        document
            .descendants()
            .any(|n| n.attribute("data-mt-key") == Some("kanban:card:a")
                && n.attribute("data-mt-role") == Some("node-label")
                && n.descendants().any(|child| child.text() == Some("Same 😀"))),
        "Kanban labels must survive the production SVG pipeline"
    );
    let pieces = result["mapping"]["pieces"].as_array().unwrap();
    let utf16: Vec<_> = KANBAN.encode_utf16().collect();
    let slice = |span: &Value| {
        String::from_utf16(
            &utf16
                [span["start"].as_u64().unwrap() as usize..span["end"].as_u64().unwrap() as usize],
        )
        .unwrap()
    };
    let cards: Vec<_> = pieces.iter().filter(|p| p["kind"] == "node").collect();
    assert_eq!(
        cards
            .iter()
            .map(|p| slice(&p["labelSpan"]))
            .collect::<Vec<_>>(),
        ["Same 😀", "Same 😀", "Ship"]
    );
    assert_eq!(
        slice(&cards[0]["span"]),
        "a[Same 😀]@{ ticket: 'T-1', assigned: 'Alice', priority: 'High' }"
    );
    assert_eq!(cards[0]["parentId"], "todo");
    assert_ne!(cards[0]["domId"], cards[1]["domId"]);
    for (field, value) in [
        ("ticket", "T-1"),
        ("assigned", "Alice"),
        ("priority", "High"),
    ] {
        assert!(
            pieces
                .iter()
                .any(|p| p["domId"] == format!("kanban:field:a:{field}")
                    && slice(&p["span"]) == value)
        );
    }
    assert!(pieces.iter().any(|p| slice(&p["span"]) == "todo[Todo]"));
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let baseline = mermaid_trace_rs::render_with(&plain, "planning-kanban", KANBAN).unwrap();
    assert_eq!(
        support::strip_trace(result["svg"].as_str().unwrap()),
        support::strip_trace(baseline["svg"].as_str().unwrap())
    );
}
