pub fn strip_trace(svg: &str) -> String {
    let document = roxmltree::Document::parse(svg).unwrap();
    let mut ranges = Vec::new();
    for node in document.descendants() {
        if node.has_tag_name("metadata") && node.has_attribute("data-mt-native") {
            ranges.push(node.range());
        } else {
            for attribute in node
                .attributes()
                .filter(|a| a.name().starts_with("data-mt-"))
            {
                let mut range = attribute.range();
                if svg.as_bytes()[range.start - 1] == b' ' {
                    range.start -= 1;
                }
                ranges.push(range);
            }
        }
    }
    ranges.sort_by_key(|r| r.start);
    let mut result = svg.to_owned();
    for range in ranges.into_iter().rev() {
        result.replace_range(range, "");
    }
    result
}
