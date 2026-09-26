use serde_json::{Value, json};
use std::io::{self, BufRead, Write};

fn main() -> io::Result<()> {
    let renderer = mermaid_trace_rs::renderer();
    let mut stdout = io::stdout().lock();
    for line in io::stdin().lock().lines() {
        let response = serde_json::from_str::<Value>(&line?)
            .map_err(|e| e.to_string())
            .and_then(|request| {
                if request["operation"] == "catalog" {
                    return Ok(json!(merman::supported_diagrams()));
                }
                let id = request["id"].as_str().ok_or("Missing diagram ID")?;
                let source = request["source"].as_str().ok_or("Missing Mermaid source")?;
                mermaid_trace_rs::render_with(&renderer, id, source)
            });
        let value = match response {
            Ok(value) => json!({"result":value}),
            Err(error) => json!({"error":error}),
        };
        writeln!(stdout, "{value}")?;
        stdout.flush()?;
    }
    Ok(())
}
