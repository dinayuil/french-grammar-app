#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    french_grammar_exercise_lib::run(tauri::generate_context!());
}
