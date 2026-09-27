use merman::{
    Engine, MermaidConfig, OperationControl, RenderOutput, RenderRequest, Renderer, SvgRequest,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn renderer() -> Renderer {
    Renderer::new().with_engine(Engine::new().with_site_config(MermaidConfig::from_value(json!({"traceSource":true,"htmlLabels":false,"deterministicIds":true,"deterministicIDSeed":"mermaid-trace"}))))
}

pub fn render(id: &str, source: &str) -> Result<Value, String> {
    render_with(&renderer(), id, source)
}

pub fn render_with(renderer: &Renderer, id: &str, source: &str) -> Result<Value, String> {
    if !id.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        || !id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err("Diagram ID must be safe for SVG".into());
    }
    if source.is_empty() || source.encode_utf16().count() > 50_000 {
        return Err("Invalid Mermaid source length".into());
    }
    let mut options = SvgRequest::default();
    options.options.diagram_id = Some(id.into());
    options.pipeline = Some(merman::svg::SvgPipeline::resvg_safe());
    let output = renderer
        .render(RenderRequest::svg(source, OperationControl::new(), options))
        .map_err(|e| e.to_string())?;
    let RenderOutput::Svg(Some(output)) = output else {
        return Err("No Mermaid diagram".into());
    };
    annotate(output.svg(), source)
}

fn annotate(svg: &str, source: &str) -> Result<Value, String> {
    // A safe SVG conversion can leave an empty renderer group after relocating its label.
    // Bind the visible replacement, keeping empty containers out of keyboard navigation.
    let visible = |node: roxmltree::Node<'_, '_>| {
        node.descendants().any(|child| {
            child.is_text() && child.text().is_some_and(|text| !text.trim().is_empty())
                || [
                    "path",
                    "line",
                    "rect",
                    "circle",
                    "ellipse",
                    "polygon",
                    "polyline",
                    "image",
                    "foreignObject",
                ]
                .iter()
                .any(|tag| child.has_tag_name(*tag))
        })
    };
    let document = roxmltree::Document::parse(svg).map_err(|e| e.to_string())?;
    let root = document.root_element();
    let occurrences: Vec<Value> = serde_json::from_str(
        root.descendants()
            .find_map(|n| n.attribute("data-mt-native"))
            .unwrap_or("[]"),
    )
    .map_err(|e| e.to_string())?;
    let mut pieces = Vec::new();
    let mut attributes: BTreeMap<usize, String> = BTreeMap::new();
    let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for mut piece in occurrences {
        if piece["kind"] == "decoration" || piece["kind"] == "nonvisual" {
            continue;
        }
        let key = piece["domId"]
            .as_str()
            .ok_or("Missing native identity")?
            .to_owned();
        if !root
            .descendants()
            .any(|n| n.attribute("data-mt-key") == Some(key.as_str()) && visible(n))
        {
            continue;
        }
        for field in ["span", "labelSpan"] {
            if let Some(span) = piece.get_mut(field) {
                for bound in ["start", "end"] {
                    let byte = span[bound].as_u64().ok_or("Missing native range")? as usize;
                    let prefix = source.get(..byte).ok_or("Invalid native source boundary")?;
                    span[bound] = json!(prefix.encode_utf16().count());
                }
            }
        }
        piece["id"] = json!(format!("p{}", pieces.len()));
        groups.entry(key).or_default().push(pieces.len());
        pieces.push(piece);
    }
    for (key, mut indices) in groups {
        // Preserve occurrence queries while using the explicit declaration for visual activation.
        indices.sort_by_key(|&i| {
            (
                pieces[i]["effective"] != true,
                pieces[i].get("labelSpan").is_none(),
                pieces[i]["declaration"] != true,
            )
        });
        let primary = &pieces[indices[0]];
        if primary["kind"] == "node"
            && primary["effective"] != true
            && !key.starts_with("state:")
            && indices
                .iter()
                .filter(|&&i| pieces[i].get("labelSpan").is_some())
                .count()
                > 1
        {
            return Err("Unsupported source map: multiple explicit labels for one node".into());
        }
        let kind = primary["kind"].as_str().ok_or("Missing native kind")?;
        let refs = indices
            .iter()
            .map(|&i| pieces[i]["id"].as_str().expect("assigned piece ID"))
            .collect::<Vec<_>>()
            .join(" ");
        let label_ref = primary["id"].as_str().expect("assigned piece ID");
        for node in root
            .descendants()
            .filter(|n| n.attribute("data-mt-key") == Some(key.as_str()) && visible(*n))
        {
            let label = node.attribute("data-mt-label") == Some("true");
            if label && primary.get("labelSpan").is_none() {
                continue;
            }
            bind(
                svg,
                node,
                primary,
                if label { label_ref } else { &refs },
                kind,
                label,
                &mut attributes,
            )?;
            // A label is a child of a renderer-owned identity; never associate it by its text.
            if !label && (primary.get("labelSpan").is_some() || kind == "node") {
                for text in node
                    .descendants()
                    .filter(|n| n.has_tag_name("text") && visible(*n))
                {
                    if text
                        .ancestors()
                        .skip(1)
                        .find(|n| n.has_attribute("data-mt-key"))
                        == Some(node)
                        && !text
                            .descendants()
                            .any(|child| child.has_attribute("data-mt-key"))
                        && !text
                            .ancestors()
                            .take_while(|ancestor| *ancestor != node)
                            .any(|ancestor| ancestor.has_attribute("data-mt-generated"))
                    {
                        bind(svg, text, primary, label_ref, kind, true, &mut attributes)?;
                    }
                }
            }
        }
    }
    let map = json!({"format":"mermaid-trace/1", "source":source, "pieces":pieces});
    attributes.insert(
        tag_end(svg, root)?,
        format!(" data-mt-map=\"{}\"", percent_encode(&map.to_string())),
    );
    let mut annotated = svg.to_string();
    for (offset, attrs) in attributes.into_iter().rev() {
        annotated.insert_str(offset, &attrs);
    }
    Ok(
        json!({"source":source,"svg":annotated,"mapping":map,"semantic":{"type":root.attribute("aria-roledescription").unwrap_or("unknown"),"pieces":map["pieces"]}}),
    )
}

fn bind(
    svg: &str,
    node: roxmltree::Node<'_, '_>,
    piece: &Value,
    id: &str,
    kind: &str,
    label: bool,
    attrs: &mut BTreeMap<usize, String>,
) -> Result<(), String> {
    let span = if label {
        piece.get("labelSpan").unwrap_or(&piece["span"])
    } else {
        &piece["span"]
    };
    let role = format!("{kind}{}", if label { "-label" } else { "" });
    let addition = format!(
        " data-mt-refs=\"{id}\" data-mt-role=\"{role}\" data-mt-start=\"{}\" data-mt-end=\"{}\"",
        span["start"], span["end"]
    );
    if attrs.insert(tag_end(svg, node)?, addition).is_some() {
        return Err("Duplicate native SVG binding".into());
    }
    Ok(())
}

fn tag_end(svg: &str, node: roxmltree::Node<'_, '_>) -> Result<usize, String> {
    let mut quote = None;
    for (index, byte) in svg.as_bytes()[node.range().start..].iter().enumerate() {
        match (*byte, quote) {
            (b'\'' | b'"', None) => quote = Some(*byte),
            (c, Some(q)) if c == q => quote = None,
            (b'>', None) => {
                let end = node.range().start + index;
                return Ok(if svg.as_bytes()[end - 1] == b'/' {
                    end - 1
                } else {
                    end
                });
            }
            _ => {}
        }
    }
    Err("Invalid SVG start tag".into())
}

fn percent_encode(value: &str) -> String {
    use std::fmt::Write;
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            result.push(byte as char);
        } else {
            let _ = write!(result, "%{byte:02X}");
        }
    }
    result
}
