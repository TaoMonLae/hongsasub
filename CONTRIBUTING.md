# Contributing to HongsaSub

Thank you for helping make Mon subtitling easier. Every kind of help counts: bug reports, Mon language corrections, ideas and code.

## Ways to help

- **Report a bug.** Open an issue that says what you did, what you expected, and what happened. Attach the subtitle file if you can, or a few lines from it.
- **Improve the Mon language support.** If the spell-check marks a correct word, a dictionary entry is wrong, or a translation hint reads badly, open an issue with the word and a short example sentence.
- **Suggest a feature.** Describe the translation or timing problem it solves first, then the idea.
- **Send a pull request.** Small, focused changes are easiest to review.

## Set up

You need Rust (stable), Node.js 20+, pnpm and ffmpeg. See the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your system.

```bash
git clone https://github.com/TaoMonLae/hongsasub.git
cd hongsasub
pnpm install
pnpm tauri dev
```

## Before you open a pull request

Run all three and make sure they pass:

```bash
cargo test --workspace
npx tsc --noEmit -p .
pnpm build
```

## Code style

- **No comments in the code.** Explain intent through clear names and small functions. Put the reasoning in the pull request description instead.
- **Rust:** use `cargo fmt`. Keep file format logic in `crates/hongsasub-core` with tests, and keep `src-tauri` thin.
- **TypeScript:** strict mode, no `any`. Put logic that does not need React in `src/lib/` so it is easy to test.
- **Interface text:** short, plain English that says what will happen, for example "Fill drafts", not "Submit".
- **Files:** never overwrite a user's file in place. Write to a temporary file and rename it, as `project.rs` does.
- **Undo:** every change to lines or styles must go through the history, so one `⌘Z` reverts it.

## Commit messages

Use the imperative mood and say what changes for the user, for example "Snap timeline drags to speech". Keep the first line under 72 characters.

## License

By contributing, you agree that your contributions are dual-licensed under the [MIT](LICENSE-MIT) and [Apache-2.0](LICENSE-APACHE) licenses, like the rest of the project.
