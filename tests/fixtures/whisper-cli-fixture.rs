// MOCKED Whisper CLI protocol; only subprocess ownership/arguments are real.
use std::{env, fs, thread, time::Duration};

fn json_string(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            value if value.is_control() => output.push_str(&format!("\\u{:04x}", value as u32)),
            value => output.push(value),
        }
    }
    output.push('"');
    output
}

fn main() {
    let arguments: Vec<String> = env::args().collect();
    let argument = |name: &str| {
        arguments
            .iter()
            .position(|value| value == name)
            .and_then(|index| arguments.get(index + 1))
            .map(String::as_str)
    };
    let state_path = env!("PKS_MOCK_WHISPER_STATE_PATH");
    if !state_path.is_empty() {
        fs::write(
            state_path,
            format!(
                "{{\"pid\":{},\"input\":{}}}",
                std::process::id(),
                json_string(argument("-f").expect("input argument"))
            ),
        )
        .expect("write owned child state");
        loop {
            thread::sleep(Duration::from_secs(1));
        }
    }
    let text = argument("--prompt")
        .or_else(|| argument("-ac"))
        .unwrap_or("default");
    let output = format!("{}.json", argument("-of").expect("output argument"));
    fs::write(output, format!("{{\"transcription\":[{{\"text\":{},\"offsets\":{{\"from\":0,\"to\":10}}}}],\"result\":{{\"language\":\"en\"}}}}", json_string(text)))
        .expect("write mocked model result");
}
