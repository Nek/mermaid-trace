mod support;
use serde_json::Value;

const GANTT: &str = "---\r\nconfig:\r\n  theme: default\r\n---\r\ngantt\r\n  title Plan 😀\r\n  dateFormat YYYY-MM-DD\r\n  todayMarker off\r\n  section Build\r\n  Same 😀 :done, a, 2026-01-01, 2d\r\n  Same 😀 :crit, b, after a, 1d\r\n  Ship :milestone, c, after b, 0d\r\n";

#[test]
fn gantt_2_directives_retain_each_nonvisual_source_origin() {
    let source = "---\r\nconfig:\r\n  htmlLabels: false\r\n---\r\ngantt\r\n%% 😀 comment\r\n  dateFormat YYYY-MM-DD\r\n  inclusiveEndDates\r\n  topAxis\r\n  axisFormat %Y-%m-%d ; note\r\n  tickInterval 1day\r\n  includes weekends\r\n  excludes weekends\r\n  todayMarker off\r\n  weekday monday\r\n  weekend friday\r\n  dateFormat YYYY-MM-DD\r\n  topAxis\r\n  Task :a, 2026-01-01, 1d\r\n";
    let result = mermaid_trace_rs::render("gantt-directives", source).unwrap();
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    let native: Vec<Value> = serde_json::from_str(
        svg.descendants()
            .find_map(|node| node.attribute("data-mt-native"))
            .unwrap(),
    )
    .unwrap();
    let directives: Vec<_> = native
        .iter()
        .filter(|item| item["classification"] == "gantt-directive")
        .collect();
    let expected = [
        ("dateFormat", "dateFormat YYYY-MM-DD", Some("YYYY-MM-DD")),
        ("inclusiveEndDates", "inclusiveEndDates", None),
        ("topAxis", "topAxis", None),
        ("axisFormat", "axisFormat %Y-%m-%d ", Some("%Y-%m-%d")),
        ("tickInterval", "tickInterval 1day", Some("1day")),
        ("includes", "includes weekends", Some("weekends")),
        ("excludes", "excludes weekends", Some("weekends")),
        ("todayMarker", "todayMarker off", Some("off")),
        ("weekday", "weekday monday", Some("monday")),
        ("weekend", "weekend friday", Some("friday")),
        ("dateFormat", "dateFormat YYYY-MM-DD", Some("YYYY-MM-DD")),
        ("topAxis", "topAxis", None),
    ];
    assert_eq!(directives.len(), expected.len());
    let mut search_from = 0;
    for (item, (kind, statement, payload)) in directives.iter().zip(expected) {
        let start = search_from + source[search_from..].find(statement).unwrap();
        let end = start + statement.len();
        search_from = end;
        assert_eq!(item["kind"], "nonvisual");
        assert_eq!(item["semanticId"], kind);
        assert_eq!(item["origin"], "body");
        assert_eq!(item["span"], serde_json::json!({"start":start,"end":end}));
        assert!(item["domId"].is_null());
        match payload {
            Some(payload) => {
                let offset = statement.find(payload).unwrap();
                assert_eq!(
                    item["labelSpan"],
                    serde_json::json!({"start":start+offset,"end":start+offset+payload.len()})
                );
            }
            None => assert!(item["labelSpan"].is_null()),
        }
    }
    assert!(
        result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .all(|piece| {
                !directives
                    .iter()
                    .any(|directive| piece["semanticId"] == directive["semanticId"])
            })
    );
    assert!(
        result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .any(|piece| piece["domId"] == "gantt:task:a")
    );
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let baseline = mermaid_trace_rs::render_with(&plain, "gantt-directives", source).unwrap();
    assert_eq!(
        support::strip_trace(result["svg"].as_str().unwrap()),
        support::strip_trace(baseline["svg"].as_str().unwrap())
    );
}

#[test]
fn gantt_2_title_occurrences_preserve_visible_owner_and_nonvisual_replacements() {
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    for (body, visible, mapped_body, nonvisual_body) in [
        ("  title First 😀\r\n  title Last 😀\r\n", "Last 😀", 2, 0),
        ("  title First 😀\r\n  title  \r\n", " ", 0, 2),
        ("  title Body 😀\r\n", "Body 😀", 1, 0),
        ("", "Configured 😀", 1, 0),
    ] {
        let source = format!(
            "---\r\ntitle: Configured 😀\r\n---\r\ngantt\r\n{body}  dateFormat YYYY-MM-DD\r\n  Task :a, 2026-01-01, 1d\r\n"
        );
        let result = mermaid_trace_rs::render("gantt-titles", &source).unwrap();
        let baseline = mermaid_trace_rs::render_with(&plain, "gantt-titles", &source).unwrap();
        assert_eq!(
            support::strip_trace(result["svg"].as_str().unwrap()),
            support::strip_trace(baseline["svg"].as_str().unwrap())
        );
        let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
        let title = svg
            .descendants()
            .find(|node| node.attribute("class") == Some("titleText"))
            .unwrap();
        assert_eq!(title.text().unwrap_or_default(), visible);
        let native: Vec<Value> = serde_json::from_str(
            svg.descendants()
                .find_map(|node| node.attribute("data-mt-native"))
                .unwrap(),
        )
        .unwrap();
        let body_records: Vec<_> = native
            .iter()
            .filter(|item| item["origin"] == "body" && item["semanticId"] == "title")
            .collect();
        assert_eq!(
            body_records.len(),
            body.matches("title ").count(),
            "every body title retains its own occurrence"
        );
        let mapped: Vec<_> = result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["semanticId"] == "title")
            .collect();
        assert_eq!(mapped.len(), mapped_body);
        assert_eq!(
            body_records
                .iter()
                .filter(|item| item["kind"] == "nonvisual")
                .count(),
            nonvisual_body
        );
        for (index, occurrence) in body_records.iter().enumerate() {
            let byte = source.match_indices("title ").nth(index).unwrap().0;
            let line = source[byte..].split("\r\n").next().unwrap();
            assert_eq!(
                occurrence["span"],
                serde_json::json!({"start":byte,"end":byte+line.len()})
            );
            let label_start = occurrence["labelSpan"]["start"].as_u64().unwrap() as usize;
            let label_end = occurrence["labelSpan"]["end"].as_u64().unwrap() as usize;
            assert_eq!(
                &source[label_start..label_end],
                if line == "title  " {
                    " "
                } else {
                    line.strip_prefix("title ").unwrap()
                }
            );
            if occurrence["kind"] != "nonvisual" {
                let mapped_piece = mapped
                    .iter()
                    .find(|piece| piece["span"]["start"] == source[..byte].encode_utf16().count())
                    .unwrap();
                assert_eq!(
                    mapped_piece["span"]["end"],
                    source[..byte + line.len()].encode_utf16().count()
                );
                assert_eq!(
                    mapped_piece["labelSpan"],
                    serde_json::json!({"start":source[..label_start].encode_utf16().count(),"end":source[..label_end].encode_utf16().count()})
                );
                assert_eq!(mapped_piece["effective"], index + 1 == body_records.len());
            }
        }
        if body.is_empty() {
            let yaml = mapped[0];
            let value = source.find("Configured 😀").unwrap();
            assert_eq!(
                yaml["span"]["start"],
                source[..source.find("title:").unwrap()]
                    .encode_utf16()
                    .count()
            );
            assert_eq!(
                yaml["labelSpan"],
                serde_json::json!({"start":source[..value].encode_utf16().count(),"end":source[..value+"Configured 😀".len()].encode_utf16().count()})
            );
        }
        if nonvisual_body > 0 {
            assert_eq!(body_records[0]["classification"], "superseded-title");
            assert_eq!(body_records[1]["classification"], "empty-title");
            assert!(native.iter().all(|item| item["domId"] != "gantt:title"));
        }
    }
}

#[test]
fn gantt_2_accessibility_statements_keep_exact_nonvisual_origins() {
    let source = "gantt\r\n  accTitle: First 😀\r\n  accTitle: Last 😀\r\n  accDescr: Old text\r\n  accDescr {\r\n    New 😀 line\r\n    second line\r\n  }\r\n  dateFormat YYYY-MM-DD\r\n  Task :a, 2026-01-01, 1d\r\n";
    let result = mermaid_trace_rs::render("gantt-accessibility", source).unwrap();
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    let native: Vec<Value> = serde_json::from_str(
        svg.descendants()
            .find_map(|node| node.attribute("data-mt-native"))
            .unwrap(),
    )
    .unwrap();
    let accessibility: Vec<_> = native
        .iter()
        .filter(|item| item["classification"] == "accessibility")
        .collect();
    assert_eq!(
        accessibility.len(),
        4,
        "every authored accessibility statement survives"
    );
    for (index, (kind, statement, payload, effective)) in [
        ("accTitle", "accTitle: First 😀", "First 😀", false),
        ("accTitle", "accTitle: Last 😀", "Last 😀", true),
        ("accDescr", "accDescr: Old text", "Old text", false),
        (
            "accDescr",
            "accDescr {\r\n    New 😀 line\r\n    second line\r\n  }",
            "New 😀 line\r\n    second line",
            true,
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let occurrence = accessibility[index];
        let start = source.find(statement).unwrap();
        let label_start = source.find(payload).unwrap();
        assert_eq!(occurrence["kind"], "nonvisual");
        assert_eq!(occurrence["semanticId"], kind);
        assert_eq!(occurrence["origin"], "body");
        assert_eq!(occurrence["effective"], effective);
        assert_eq!(
            occurrence["span"],
            serde_json::json!({"start":start,"end":start+statement.len()})
        );
        assert_eq!(
            occurrence["labelSpan"],
            serde_json::json!({"start":label_start,"end":label_start+payload.len()})
        );
        assert!(occurrence["domId"].is_null());
    }
    assert!(
        result["mapping"]["pieces"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["semanticId"] != "accTitle" && item["semanticId"] != "accDescr")
    );
    let title = svg
        .descendants()
        .find(|node| node.has_tag_name("title"))
        .unwrap();
    let description = svg
        .descendants()
        .find(|node| node.has_tag_name("desc"))
        .unwrap();
    assert_eq!(title.text(), Some("Last 😀"));
    assert_eq!(description.text(), Some("New 😀 line\nsecond line"));
    let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
    let baseline = mermaid_trace_rs::render_with(&plain, "gantt-accessibility", source).unwrap();
    assert_eq!(
        support::strip_trace(result["svg"].as_str().unwrap()),
        support::strip_trace(baseline["svg"].as_str().unwrap())
    );

    let cleared = "gantt\naccTitle: First\naccTitle:\naccDescr: Before\naccDescr { }\ndateFormat YYYY-MM-DD\nTask :a, 2026-01-01, 1d\n";
    let result = mermaid_trace_rs::render("gantt-accessibility-clear", cleared).unwrap();
    let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
    let native: Vec<Value> = serde_json::from_str(
        svg.descendants()
            .find_map(|node| node.attribute("data-mt-native"))
            .unwrap(),
    )
    .unwrap();
    let records: Vec<_> = native
        .iter()
        .filter(|item| item["classification"] == "accessibility")
        .collect();
    assert_eq!(records.len(), 4);
    assert_eq!(
        records
            .iter()
            .map(|item| item["effective"].as_bool().unwrap())
            .collect::<Vec<_>>(),
        [false, true, false, true]
    );
    assert!(
        records
            .iter()
            .all(|item| item["kind"] == "nonvisual" && item["domId"].is_null())
    );
    assert!(
        svg.descendants()
            .all(|node| !node.has_tag_name("title") && !node.has_tag_name("desc"))
    );
    assert!(
        mermaid_trace_rs::render("gantt-accessibility-invalid", "gantt\naccDescr {unclosed\n")
            .is_err()
    );
}

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
fn gantt_2_section_titles_keep_the_first_rendered_task_origin() {
    let body = "gantt\r\n  dateFormat YYYY-MM-DD\r\n  Unsectioned :r, 2026-01-01, 1d\r\n  section Work 😀<br>Area\r\n  section Vertical\r\n  Marker :vert, v, 2026-01-01, 1d\r\n  section Other\r\n  Other task :o, 2026-01-02, 1d\r\n  section Work 😀<br>Area\r\n  Work task :w, 2026-01-03, 1d\r\n  section Other\r\n  Other again :o2, 2026-01-04, 1d\r\n  section Work 😀<br>Area\r\n  Work again :w2, 2026-01-05, 1d\r\n  section Empty\r\n";
    for compact in [false, true] {
        for html in [false, true] {
            let mode = if compact {
                "displayMode: compact\r\n"
            } else {
                ""
            };
            let source = format!("---\r\n{mode}config:\r\n  htmlLabels: {html}\r\n---\r\n{body}");
            let result = mermaid_trace_rs::render("gantt-sections", &source).unwrap();
            let pieces = result["mapping"]["pieces"].as_array().unwrap();
            let svg = roxmltree::Document::parse(result["svg"].as_str().unwrap()).unwrap();
            let native: Vec<Value> = serde_json::from_str(
                svg.descendants()
                    .find_map(|node| node.attribute("data-mt-native"))
                    .unwrap(),
            )
            .unwrap();
            let expected = [
                ("Work 😀<br>Area", None),
                ("Vertical", None),
                ("Other", Some(2)),
                ("Work 😀<br>Area", Some(3)),
                ("Other", Some(2)),
                ("Work 😀<br>Area", Some(3)),
                ("Empty", None),
            ];
            let mut search = source.find("gantt").unwrap();
            for (index, (name, owner)) in expected.iter().enumerate() {
                let relative = source[search..].find("section ").unwrap();
                let byte = search + relative;
                let statement = format!("section {name}");
                let span = serde_json::json!({"start":source[..byte].encode_utf16().count(),"end":source[..byte+statement.trim_end().len()].encode_utf16().count()});
                let occurrence = native
                    .iter()
                    .find(|piece| piece["sectionIndex"] == index)
                    .expect("every section declaration retains provenance");
                assert_eq!(
                    occurrence["span"],
                    serde_json::json!({"start":byte,"end":byte+statement.trim_end().len()})
                );
                match owner {
                    Some(owner) => {
                        assert_eq!(occurrence["semanticId"], format!("section:{owner}"));
                        assert_eq!(occurrence["effective"], *owner == index);
                        assert_eq!(occurrence["domId"], format!("gantt:section:{name}"));
                        let piece = pieces
                            .iter()
                            .find(|piece| piece["sectionIndex"] == index)
                            .unwrap();
                        assert_eq!(piece["span"], span);
                        assert_eq!(
                            piece["labelSpan"],
                            serde_json::json!({"start":source[..byte+"section ".len()].encode_utf16().count(),"end":source[..byte+statement.len()].encode_utf16().count()})
                        );
                        let titles = svg
                            .descendants()
                            .filter(|node| {
                                node.attribute("data-mt-key")
                                    == Some(format!("gantt:section:{name}").as_str())
                            })
                            .collect::<Vec<_>>();
                        assert_eq!(
                            titles.len(),
                            1,
                            "repeated section names render one category title"
                        );
                        let title = titles[0];
                        assert_eq!(
                            title
                                .attribute("data-mt-start")
                                .unwrap()
                                .parse::<usize>()
                                .unwrap(),
                            source[..source
                                .find(if *owner == 2 {
                                    "section Other"
                                } else {
                                    "section Work 😀<br>Area\r\n  Work task"
                                })
                                .unwrap()]
                                .encode_utf16()
                                .count()
                        );
                    }
                    None => {
                        assert_eq!(occurrence["semanticId"], format!("section:{index}"));
                        assert_eq!(occurrence["kind"], "nonvisual");
                        assert_eq!(occurrence["classification"], "unrendered-section");
                        assert!(!pieces.iter().any(|piece| piece["sectionIndex"] == index));
                    }
                }
                search = byte + statement.len();
            }
            assert!(
                !pieces
                    .iter()
                    .any(|piece| piece["domId"] == "gantt:section:"),
                "an unsectioned task has no authored section title"
            );
            let plain = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(serde_json::json!({"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))));
            let baseline =
                mermaid_trace_rs::render_with(&plain, "gantt-sections", &source).unwrap();
            assert_eq!(
                support::strip_trace(result["svg"].as_str().unwrap()),
                support::strip_trace(baseline["svg"].as_str().unwrap())
            );
        }
    }
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
