mod support;

use serde_json::json;

#[test]
fn sanitizer_subtree_policy_filters_rendered_labels_without_rewriting_source() {
    let label = "<div>Hidden <b>nested</b></div>Alpha 😀";
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            for option in ["FORBID_CONTENTS", "ADD_FORBID_CONTENTS"] {
                let config = json!({"layout":layout,"htmlLabels":html,"dompurifyConfig":{"FORBID_TAGS":["div"],option:["DIV"]}});
                for from_source in [false, true] {
                    let body =
                        format!("%% Original 😀\r\nflowchart LR\r\nA[\"{label}\"] --> B[Beta]");
                    let source = if from_source {
                        format!("---\r\nconfig: {config}\r\n---\r\n{body}")
                    } else {
                        body
                    };
                    let render = |trace| {
                        let mut site = if from_source {
                            json!({})
                        } else {
                            config.clone()
                        };
                        site["traceSource"] = json!(trace);
                        let renderer = merman::Renderer::new().with_engine(
                            merman::Engine::new()
                                .with_site_config(merman::MermaidConfig::from_value(site)),
                        );
                        mermaid_trace_rs::render_with(&renderer, "sanitizer-content", &source)
                            .unwrap()
                    };
                    let mapped = render(true);
                    let plain = render(false);
                    let svg = mapped["svg"].as_str().unwrap();
                    let doc = roxmltree::Document::parse(svg).unwrap();
                    let text: String = doc
                        .descendants()
                        .filter(|n| n.has_tag_name("text"))
                        .map(support::text_content)
                        .collect();
                    assert!(
                        text.contains("Alpha 😀"),
                        "{layout} {html} {option}: {text}"
                    );
                    assert!(
                        !text.contains("Hidden") && !text.contains("nested"),
                        "{layout} {html} {option}: {text}"
                    );
                    assert_eq!(mapped["mapping"]["source"], source);
                    let start = source[..source.find(label).unwrap()].encode_utf16().count();
                    let span = json!({"start":start,"end":start+label.encode_utf16().count()});
                    assert!(
                        mapped["mapping"]["pieces"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|piece| piece["labelSpan"] == span)
                    );
                    assert_eq!(
                        support::strip_trace(svg),
                        support::strip_trace(plain["svg"].as_str().unwrap())
                    );
                }
            }
        }
    }
}

#[test]
fn template_safe_node_edge_and_group_labels_keep_original_owned_ranges() {
    let labels = ["Alpha 😀 ${secret}", "Next ${secret}", "Group ${secret}"];
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            for from_source in [false, true] {
                let config = json!({"layout":layout,"htmlLabels":html,"dompurifyConfig":{"SAFE_FOR_TEMPLATES":true}});
                let body = format!(
                    "%% Original 😀\r\nflowchart LR\r\nsubgraph G[\"{}\"]\r\nA[\"{}\"] ab@-->|\"{}\"| B[Beta]\r\nend",
                    labels[2], labels[0], labels[1]
                );
                let source = if from_source {
                    format!("---\r\nconfig: {config}\r\n---\r\n{body}")
                } else {
                    body
                };
                let render = |trace| {
                    let mut site = if from_source {
                        json!({})
                    } else {
                        config.clone()
                    };
                    site["traceSource"] = json!(trace);
                    let renderer = merman::Renderer::new().with_engine(
                        merman::Engine::new()
                            .with_site_config(merman::MermaidConfig::from_value(site)),
                    );
                    mermaid_trace_rs::render_with(&renderer, "template-safe", &source).unwrap()
                };
                let mapped = render(true);
                let plain = render(false);
                let svg = mapped["svg"].as_str().unwrap();
                let doc = roxmltree::Document::parse(svg).unwrap();
                let text: String = doc
                    .descendants()
                    .filter(|n| n.has_tag_name("text"))
                    .map(support::text_content)
                    .collect();
                for label in labels {
                    assert!(
                        text.contains(label.split(" ${").next().unwrap()),
                        "{layout} {html}: {text}"
                    );
                    let start = source[..source.find(label).unwrap()].encode_utf16().count();
                    let span = json!({"start":start,"end":start+label.encode_utf16().count()});
                    assert!(
                        mapped["mapping"]["pieces"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|piece| piece["labelSpan"] == span),
                        "{label}: {}",
                        mapped["mapping"]["pieces"]
                    );
                }
                assert!(!text.contains("secret"), "{layout} {html}: {text}");
                assert_eq!(mapped["mapping"]["source"], source);
                assert_eq!(
                    support::strip_trace(svg),
                    support::strip_trace(plain["svg"].as_str().unwrap())
                );
            }
        }
    }
}

#[test]
fn fully_filtered_labels_match_an_equivalent_entity_authored_space() {
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            let renderer = merman::Renderer::new().with_engine(merman::Engine::new().with_site_config(merman::MermaidConfig::from_value(json!({"traceSource":true,"layout":layout,"htmlLabels":html,"dompurifyConfig":{"SAFE_FOR_TEMPLATES":true}}))));
            let source = "flowchart LR\nsubgraph G[\"${secret}\"]\nA[\"${secret}\"] ab@-->|\"${secret}\"| B[Beta]\nend";
            let mapped =
                mermaid_trace_rs::render_with(&renderer, "template-blank", source).unwrap();
            // Mermaid trims literal whitespace before sanitization; #32; authors the replacement space.
            let blank = mermaid_trace_rs::render_with(
                &renderer,
                "template-blank",
                &source.replace("${secret}", "#32;"),
            )
            .unwrap();
            assert_eq!(
                support::strip_trace(mapped["svg"].as_str().unwrap()),
                support::strip_trace(blank["svg"].as_str().unwrap()),
                "{layout} {html}"
            );
            assert_eq!(mapped["mapping"]["source"], source);
        }
    }
}

#[test]
fn attribute_policies_preserve_actual_label_text_and_exact_source() {
    let label =
        "<span id='item' name='tag' title='left/>right' style='color:red;/* /> */'>Alpha 😀</span>";
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            for allow in [false, true] {
                for named in [false, true] {
                    for from_source in [false, true] {
                        let config = json!({"layout":layout,"htmlLabels":html,"dompurifyConfig":{"ALLOW_SELF_CLOSE_IN_ATTR":allow,"SANITIZE_NAMED_PROPS":named}});
                        let body =
                            format!("%% Original 😀\r\nflowchart LR\r\nA[\"{label}\"] --> B[Beta]");
                        let source = if from_source {
                            format!("---\r\nconfig: {config}\r\n---\r\n{body}")
                        } else {
                            body
                        };
                        let render = |trace| {
                            let mut site = if from_source {
                                json!({})
                            } else {
                                config.clone()
                            };
                            site["traceSource"] = json!(trace);
                            let renderer = merman::Renderer::new().with_engine(
                                merman::Engine::new()
                                    .with_site_config(merman::MermaidConfig::from_value(site)),
                            );
                            mermaid_trace_rs::render_with(&renderer, "attribute-policy", &source)
                                .unwrap()
                        };
                        let mapped = render(true);
                        let plain = render(false);
                        let svg = mapped["svg"].as_str().unwrap();
                        let doc = roxmltree::Document::parse(svg).unwrap();
                        let visual = doc
                            .descendants()
                            .find(|n| {
                                n.attribute("data-mt-key") == Some("node:A")
                                    && n.attribute("data-mt-role") == Some("node-label")
                            })
                            .unwrap();
                        // SVG-text labels preserve literal markup; HTML labels render its contents.
                        let expected = if html {
                            "Alpha 😀".to_owned()
                        } else {
                            let identity = if named {
                                r#"id="user-content-item" name="user-content-tag""#
                            } else {
                                "id='item' name='tag'"
                            };
                            let attributes = if allow {
                                r#" title="left/>right" style="color:red;/* /> */""#
                            } else {
                                ""
                            };
                            format!("<span {identity}{attributes}>Alpha 😀 </span>")
                        };
                        assert_eq!(
                            support::text_content(visual),
                            expected,
                            "{layout} {html} {allow} {named}"
                        );
                        assert_eq!(
                            visual
                                .descendants()
                                .any(|n| n.attribute("fill") == Some("red")),
                            allow && html,
                            "inline style must survive only when the attribute policy permits it"
                        );
                        assert_eq!(mapped["mapping"]["source"], source);
                        let start = source[..source.find(label).unwrap()].encode_utf16().count();
                        let span = json!({"start":start,"end":start+label.encode_utf16().count()});
                        assert!(
                            mapped["mapping"]["pieces"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .any(|p| p["labelSpan"] == span)
                        );
                        assert_eq!(
                            support::strip_trace(svg),
                            support::strip_trace(plain["svg"].as_str().unwrap())
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn xml_safe_attributes_preserve_label_contents_and_original_ownership() {
    let label = "<span style='color:red;/* --> */'>Alpha 😀</span>";
    for layout in ["dagre", "elk"] {
        for html in [false, true] {
            for safe in [false, true] {
                for from_source in [false, true] {
                    let config = json!({"layout":layout,"htmlLabels":html,"dompurifyConfig":{"SAFE_FOR_XML":safe}});
                    let body =
                        format!("%% Original 😀\r\nflowchart LR\r\nA[\"{label}\"] --> B[Beta]");
                    let source = if from_source {
                        format!("---\r\nconfig: {config}\r\n---\r\n{body}")
                    } else {
                        body
                    };
                    let render = |trace| {
                        let mut site = if from_source {
                            json!({})
                        } else {
                            config.clone()
                        };
                        site["traceSource"] = json!(trace);
                        site["securityLevel"] = json!("loose");
                        let renderer = merman::Renderer::new().with_engine(
                            merman::Engine::new()
                                .with_site_config(merman::MermaidConfig::from_value(site)),
                        );
                        mermaid_trace_rs::render_with(&renderer, "xml-attribute-policy", &source)
                            .unwrap()
                    };
                    let mapped = render(true);
                    let plain = render(false);
                    let svg = mapped["svg"].as_str().unwrap();
                    let doc = roxmltree::Document::parse(svg).unwrap();
                    let visual = doc
                        .descendants()
                        .find(|n| {
                            n.attribute("data-mt-key") == Some("node:A")
                                && n.attribute("data-mt-role") == Some("node-label")
                        })
                        .unwrap();
                    let expected = if html {
                        "Alpha 😀"
                    } else if safe {
                        "<span> Alpha 😀 </span>"
                    } else {
                        r#"<span style="color:red;/* --> */">Alpha 😀 </span>"#
                    };
                    assert_eq!(
                        support::text_content(visual),
                        expected,
                        "{layout} {html} {safe} {from_source}"
                    );
                    assert_eq!(
                        visual
                            .descendants()
                            .any(|n| n.attribute("fill") == Some("red")),
                        html && !safe
                    );
                    assert_eq!(mapped["mapping"]["source"], source);
                    let start = source[..source.find(label).unwrap()].encode_utf16().count();
                    let span = json!({"start":start,"end":start+label.encode_utf16().count()});
                    assert!(
                        mapped["mapping"]["pieces"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|p| p["labelSpan"] == span)
                    );
                    assert_eq!(
                        support::strip_trace(svg),
                        support::strip_trace(plain["svg"].as_str().unwrap())
                    );
                }
            }
        }
    }
}

#[test]
fn narrow_svg_labels_do_not_split_encoded_characters() {
    for layout in ["dagre", "elk"] {
        for markdown in [false, true] {
            let label = if markdown {
                "`&gt;́x&amp;&lt;`"
            } else {
                "&gt;́x&amp;&lt;"
            };
            let source = format!(
                "---\nconfig: {{layout: {layout}, htmlLabels: false, flowchart: {{wrappingWidth: 1}}}}\n---\nflowchart LR\nA[\"{label}\"]"
            );
            let mapped = mermaid_trace_rs::render("narrow-entity", &source).unwrap();
            let svg = mapped["svg"].as_str().unwrap();
            let doc = roxmltree::Document::parse(svg).unwrap();
            let visual = doc
                .descendants()
                .find(|n| {
                    n.attribute("data-mt-key") == Some("node:A")
                        && n.attribute("data-mt-role") == Some("node-label")
                })
                .unwrap();
            assert_eq!(support::text_content(visual), ">́x&<", "{layout} {markdown}");
            assert_eq!(mapped["mapping"]["source"], source);
        }
    }
}

#[test]
fn rcdata_label_text_remains_literal_in_svg_with_original_source_ranges() {
    let label = "<textarea><b>Alpha</b> &amp; Ω</textarea>";
    for layout in ["dagre", "elk"] {
        for level in ["strict", "loose"] {
            for from_source in [false, true] {
                let config = json!({"layout":layout,"securityLevel":level,"htmlLabels":true});
                let body = format!("%% Original 😀\r\nflowchart LR\r\nA[\"{label}\"] --> B[Beta]");
                let source = if from_source {
                    format!("---\r\nconfig: {config}\r\n---\r\n{body}")
                } else {
                    body
                };
                let render = |trace| {
                    let mut site = if from_source {
                        json!({})
                    } else {
                        config.clone()
                    };
                    site["traceSource"] = json!(trace);
                    let renderer = merman::Renderer::new().with_engine(
                        merman::Engine::new()
                            .with_site_config(merman::MermaidConfig::from_value(site)),
                    );
                    mermaid_trace_rs::render_with(&renderer, "rcdata-label", &source).unwrap()
                };
                let mapped = render(true);
                let plain = render(false);
                let svg = mapped["svg"].as_str().unwrap();
                let doc = roxmltree::Document::parse(svg).unwrap();
                let text: String = doc
                    .descendants()
                    .filter(|n| n.has_tag_name("text"))
                    .map(support::text_content)
                    .collect();
                assert!(
                    text.contains("<b>Alpha</b> & Ω"),
                    "{layout} {level} {from_source}: {text}"
                );
                assert_eq!(mapped["mapping"]["source"], source);
                let start = source[..source.find(label).unwrap()].encode_utf16().count();
                let span = json!({"start":start,"end":start+label.encode_utf16().count()});
                assert!(
                    mapped["mapping"]["pieces"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|piece| piece["labelSpan"] == span)
                );
                assert_eq!(
                    support::strip_trace(svg),
                    support::strip_trace(plain["svg"].as_str().unwrap())
                );
            }
        }
    }
}
