# pi-keb — pi-native Knowledge Base

A pi extension that compiles markdown documents into a structured, interlinked wiki using your LLM. Inspired by [OpenKB](https://github.com/VectifyAI/OpenKB) (which also inspired by Andrej Karparthy) but built entirely as a pi extension with no external dependencies beyond your LLM.

## Install

```bash
pi install git:github.com/auto-medica-labs/pi-keb
```

## Usage

```
/keb:workspace:init <name>           Create a named workspace
/keb:add [-f] @file | url  Add a markdown file (via @) or URL; -f skips pending-confirmation
/keb:add:content <text>    Add inline markdown text (LLM chooses the title)
/keb:query <question>      Ask a question against the knowledge base
/keb:list                  List all documents and concepts
/keb:status                Show knowledge base stats
/keb:remove <docName> [-y] Remove a document and clean up wiki pages; -y skips confirmation
/keb:repair [docName]      Re-compile interrupted /keb:add documents
/keb:workspace:clear [-y] <name>     Clear workspace content (keeps directory); -y skips confirmation
/keb:workspace:remove [-y] <name>     Delete a workspace; -y skips confirmation
/keb:workspace:status            List all workspaces and their stats
```

All commands accept `-w <name>` to target a specific workspace:

```
/keb:add -w myproject docs/design.md
/keb:query -w myproject "what is the caching strategy?"
/keb:list -w myproject
/keb:status -w myproject
/keb:remove -w myproject design
```

If no workspace is specified, commands operate on the **default** workspace at `~/.pi/agent/keb/`.

### Interrupted compilations & recovery

When you run `/keb:add`, the source file is copied and registered immediately,
but the wiki compilation (summary, concepts, index) runs asynchronously through
the LLM. If the session is interrupted mid-compilation, the registry will list
the document but the wiki will be incomplete.

**At most one document can be pending at a time.** If you try to `/keb:add` a new
document while another is still pending, pi shows a confirmation dialog: discard
the pending document and add the new one, or keep the pending one (use
`/keb:repair` to finish it). Pass `-f` to skip the dialog and force-discard:
`/keb:add -f new-file.md`. Re-adding _the same_ file or URL while it's pending
triggers a re-compile — the dedup logic runs before the guard, so retrying the
same document always works.

**Detection:** `/keb:status` shows a `⚠ Pending compilation` line. `/keb:list` marks
them with `⚠[pending]`.

**Recovery:** Run `/keb:repair` to re-compile all pending documents:

```
/keb:repair                  # Re-compile all pending docs
/keb:repair design           # Re-compile just one
/keb:repair -w myproject     # Repair a specific workspace
```

Re-adding the same file also triggers automatic recovery.

**Removal recovery:** If a `/keb:remove` session is interrupted, Phase 1 completes
synchronously so the Keb is always internally consistent. If Phase 2 (LLM cleanup)
is interrupted, affected concepts keep a `needs_review: true` flag that can be
cleared by re-running the removal or manually updating the concept.

**Confirmation bypass:** `/keb:remove`, `/keb:workspace:clear`, and `/keb:workspace:remove` each show a
confirmation dialog before destructive operations. Pass `-y` (`--yes`) to skip
this dialog: `/keb:remove -y my-doc`, `/keb:workspace:clear -y myproject`. Useful in
headless/automated contexts.

### Workspaces

Create isolated knowledge bases for different projects:

```bash
/keb:workspace:init myproject               # Create workspace
/keb:add -w myproject design.md   # Populate it
/keb:query -w myproject "what's the auth flow?"
```

Workspaces are stored as subdirectories under `~/.pi/agent/keb/workspaces/`.

To delete a workspace and all its data:

```bash
/keb:workspace:remove myproject       # Deletes everything in workspace "myproject"
/keb:workspace:remove default         # Clears the default workspace (keeps named workspaces)
```

A confirmation dialog is shown before anything is removed (bypass with `-y`).
Deleting the default workspace (`/keb:workspace:remove default`) clears its sources,
summaries, concepts, and index but preserves any named workspaces under
`workspaces/`.

## How it works

### Adding a document (`/keb:add`)

1. The source file is copied into `source/` and registered in `registry.json` with `compiled: false`
2. The LLM receives a compile prompt with the document content
3. **Summary:** The LLM writes a 200–400 word summary via `keb_write_summary` with OKF frontmatter (`type: Summary`, `keb_name`, `keb_source`, `timestamp`, plus optional `title`, `description`, `tags`). Cross-references use standard markdown links: `[text](/concepts/slug.md)`
4. **Concepts:** The LLM creates new topics via `keb_write_concept` or extends existing ones via `keb_update_concept`:
   - `keb_write_concept` — creates a new concept with an explicit sources list and OKF frontmatter (`type: Concept`, `keb_name`, `keb_sources`, `keb_needs_review`, plus optional `title`, `description`, `tags`)
   - `keb_update_concept` — updates an existing concept with new information. The new source is **automatically merged** with existing sources on the server. Old sources are preserved deterministically — the LLM never touches them
5. **Index:** The LLM calls `keb_update_index` which **filters entries against disk** before writing — any slug the LLM invented that doesn't correspond to a real file is silently dropped. Index uses standard markdown links: `[slug](/summaries/slug.md) — brief`
6. The registry entry is marked `compiled: true` at the final step (the atomic commit point)

### Adding inline content (`/keb:add:content`)

Paste text directly into the knowledge base without a file or URL:

```
/keb:add:content # My Notes on Rust

Rust is a systems programming language that...
```

1. The text is hashed and saved as `source/inline-{hash}.md` with a temporary `internal-*` docName
2. The LLM receives a compile prompt that instructs it to **first choose a meaningful docName** via `keb_set_docname(oldDocName, newDocName)`
3. After renaming, the LLM follows the same compile pipeline as `/keb:add` (summary → concepts → index)
4. If the LLM forgets to rename, `keb_write_summary` rejects temporary `inline-*` names and prompts it to try again

Same deduplication, pending-compilation guard, and `-f` override apply.

### Removing a document (`/keb:remove`)

Removal uses a **two-phase staged pipeline**. Phase 1 is entirely deterministic (no LLM); Phase 2 is an optional LLM cleanup.

**Phase 1 — deterministic structural cleanup:**

1. Delete the summary file
2. For each concept that references the removed document:
   - If the document was the **only source** → delete the concept entirely
   - If other sources remain → update the sources list, set `needs_review: true` in frontmatter, **keep the body intact** (no data loss)
3. Rebuild `index.md` from disk (scanning summaries/ and concepts/ directories)
4. Delete the source file from `source/`
5. Delete the registry entry **last** — at this point all wiki files are already consistent

**Phase 2 — LLM surgical cleanup (non-critical):**

- Only runs if concepts were affected
- The LLM reads each concept flagged `needs_review: true`, surgically removes content traceable to the deleted document, and writes back with `needs_review: false`
- If the session is interrupted during Phase 2, the Keb remains valid — concepts just have `needs_review: true` flags that can be resolved later with a re-run

### File format (Open Knowledge Format v0.1)

All wiki files use [OKF v0.1](https://github.com/auto-medica-labs/open-knowledge-format) frontmatter with keb-specific producer keys (`keb_*` prefix). Files live under `wiki/`, which is the OKF bundle root.

**Summary** (`wiki/summaries/{docName}.md`):

```markdown
---
type: Summary
title: Architecture
description: Key architectural decisions and patterns.
resource: https://github.com/org/repo/blob/main/docs/architecture.md
tags: [architecture, design]
timestamp: 2026-05-26T14:30:00Z
keb_name: "architecture"
keb_source: "architecture.md"
---

<summary prose>
```

**Concept** (`wiki/concepts/{slug}.md`):

```markdown
---
type: Concept
title: Caching Strategy
description: How caching is implemented across the architecture and design.
tags: [caching, performance]
timestamp: 2026-05-26T14:30:00Z
keb_name: "caching-strategy"
keb_sources: ["summary/architecture", "summary/design"]
keb_needs_review: false
---

<concept prose>
```

- **Standard OKF fields:** `type` (required: `Summary` or `Concept`), `title`, `description`, `resource`, `tags`, `timestamp`
- **Keb producer keys** (`keb_*` prefix): map the internal registry fields (`keb_name`, `keb_source`, `keb_sources`, `keb_needs_review`)
- **No footers** — cross-references are standard markdown links in the body: `[text](/concepts/slug.md)`, `[text](/summaries/doc.md)`
- **Bundle-relative links** resolve from `wiki/`: `/summaries/doc.md`, `/concepts/slug.md`
- All string values are **double-quoted** in frontmatter to avoid YAML edge cases

### Recovery & repair

**Compilation interrupted:** If a `/keb:add` session is interrupted mid-compilation, the registry keeps `compiled: false`. `/keb:status` shows a `⚠ Pending compilation` line. Run `/keb:repair` to resume.

**Removal interrupted:** If a `/keb:remove` session is interrupted after Phase 1 (which completes synchronously), the Keb is already consistent. If interrupted during Phase 2, concepts retain `needs_review: true` flags. Re-running `/keb:remove` for the same document or manually calling `keb_write_concept` on the affected concepts clears the flag.

### Failure modes — before vs after

| Failure                                       | Before (LLM-driven)                 | After (deterministic)                                              |
| --------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| LLM invents slug in index                     | Phantom entry                       | Filtered before write                                              |
| Session interrupted mid-remove                | Orphaned wiki files, no repair path | Phase 1 already committed; body preserved with `needs_review` flag |
| Concept body corrupted by remove              | Undetectable                        | Sources list correct, body kept, flag for review                   |
| Registry deleted before cleanup               | Inconsistent state                  | Registry deleted last, after all file ops                          |
| LLM forgets old sources when updating concept | Sources lost                        | Union from disk — old sources always preserved                     |

```
~/.pi/agent/keb/
├── registry.json         # Hash-based dedup tracking (operational cache)
├── source/               # Original file copies (outside OKF bundle)
├── wiki/                 # OKF v0.1 bundle root
│   ├── index.md          # Directory listing (standard markdown links)
│   ├── log.md            # Workspace update history (created on init)
│   ├── summaries/        # Per-document summaries
│   └── concepts/         # Cross-document topic synthesis
└── workspaces/           # Named, isolated workspaces
    └── myproject/
        ├── registry.json
        ├── source/
        └── wiki/
            ├── index.md
            ├── log.md
            ├── summaries/
            └── concepts/
```

Bundle-relative links in `wiki/` use `/summaries/docName.md` and `/concepts/slug.md` paths. The `source/` directory and `registry.json` sit outside the bundle.

## Web Page Compatibility

`/keb:add` fetches pages using a plain HTTP request and converts the raw HTML to Markdown. This works well for static or server-rendered pages but will produce thin or empty results for JavaScript-heavy sites, since no browser or JS engine is involved.

**Works well:**

- Documentation sites (plain HTML, SSG output)
- Wikipedia, blog posts, news articles
- GitHub READMEs and rendered markdown pages
- Most technical references and man pages

**Likely to fail or produce poor output:**

- Single-page applications (React, Vue, Angular)
- Pages that require login or session cookies
- Sites behind Cloudflare or bot-detection challenges
- Content loaded via infinite scroll or lazy fetch

If a page produces an empty or garbled result, try finding a static mirror, an archived version at web.archive.org, or export the content manually as a `.md` file and use `/keb:add <file.md>` instead.

## Query from anywhere

The knowledge base lives in `~/.pi/agent/keb/` — a fixed location in your home directory, not inside any project or repository. Once you've compiled documents, you can run `/keb:query` (with an optional `-w` workspace flag) from any directory on your machine. There's no need to be inside the repo where the source files originally came from.

Cross-reference documents across workspaces by switching between them:

```
/keb:query "how does this repo handle errors?"
/keb:query -w backend "how does this repo handle errors?"
```

## Version controlling your Keb

The `~/.pi/agent/keb/` folder is plain files — `registry.json` and markdown — so it's easy to track with Git if you want history, backups, or to sync across machines.

```bash
cd ~/.pi/agent/keb
git init
echo "source/" >> .gitignore   # optionally skip raw source copies
git add .
git commit -m "initial keb snapshot"
```

From there, commit whenever you add documents, push to a private remote to back up or share the compiled wiki, and pull on another machine to restore it. Since `/keb:add` deduplicates via `registry.json`, the state will be consistent as long as the registry and wiki are in sync.

## Requirements

- pi coding agent

## Headless execution (RPC mode)

pi-keb commands are designed for **interactive** use in pi's TUI — the
terminal interface where `ctx.ui.confirm()` pops up a dialog and
`ctx.ui.notify()` renders inline status messages. When pi runs in
**headless RPC mode** (as the Keb bridge does), these UI interactions
translate to the [extension UI protocol][rpc] over stdin/stdout and have
important limitations.

### How headless mode differs

| Feature | Interactive (TUI) | Headless (RPC) |
| --- | --- | --- |
| `ctx.ui.confirm()` | Dialog in terminal, user responds | Emits `extension_ui_request`, **blocks** waiting for stdin response |
| `ctx.ui.notify()` | Inline status in terminal | Emits `extension_ui_request` (fire-and-forget) |
| Interrupted compilation | User can `/keb:repair` from session | Bridge detects `compiled: false` in registry, re-compiles |
| Session persistence | Full session saved, resumable | `--no-session` — ephemeral, no resume |

### Confirmation dialogs will hang

Several commands call `ctx.ui.confirm()` to ask the user a question
before proceeding. In RPC/headless mode, pi emits an
`extension_ui_request` event on stdout and **blocks indefinitely**
waiting for an `extension_ui_response` on stdin. If the headless
consumer (e.g. Keb bridge) does not send a response, pi hangs forever.

Commands that use confirmation dialogs:

- `/keb:add` — when a pending compilation exists and `-f` is not passed
- `/keb:add:content` — same guard, asks to discard pending before adding new
- `/keb:remove` — confirms before deleting (bypass with `-y`)
- `/keb:workspace:clear` — confirms before clearing workspace (bypass with `-y`)
- `/keb:workspace:remove` — confirms before deleting workspace (bypass with `-y`)

Commands that are **safe** in headless mode (no confirmation dialogs):

- `/keb:workspace:init` — creates workspace, synchronous fs write only
- `/keb:repair` — recompiles pending docs, no confirms
- `/keb:list`, `/keb:status`, `/keb:workspace:status` — read-only, no confirms
- `/keb:query` — sends LLM prompt, no confirms

### Required contract for headless consumers

To avoid hangs, headless consumers **must**:

1. **Always pass `-f` (force)** on `/keb:add` and `/keb:add:content`.
   This skips the "discard pending?" confirmation. The Keb bridge does
   this in `src/handlers/command-handler.js` and
   `src/handlers/add-content-handler.js`.

2. **Pass `-y` (yes) to bypass confirmations** on `/keb:remove`,
   `/keb:workspace:clear`, and `/keb:workspace:remove`. Without `-y`, these commands block
   waiting for a confirm response on stdin. With `-y`, they proceed
   immediately (same as `-f` for `/keb:add`). Keb bridge does not use
   these commands, but if a consumer needs them, always pass `-y`.

3. **Treat `extension_ui_request` events as optional**. The
   fire-and-forget ones (`notify`, `setStatus`, etc.) can be silently
   ignored. Dialog ones (`confirm`, `select`, etc.) should never be
   received if the consumer follows rules 1 and 2.

### Notification loss

`ctx.ui.notify()` calls in headless mode emit `extension_ui_request`
with `method: "notify"`. The Keb bridge forwards these as generic
WebSocket events, but the Chrome extension client does not render them.
This means informational messages like "Fetching: <url>" or "Added:
<filename>" are invisible to the end user in the side panel.

This is an intentional design choice: the Chrome extension aims for
simplicity and does not replicate pi's full TUI. Consumers who want
rich status reporting can listen for `extension_ui_request` events
and render them themselves.

### Design rationale

pi-keb is an interactive-first extension. Confirmation dialogs and
notifications are essential to its normal UX. Rather than maintaining
two code paths (headless vs interactive), pi-keb keeps one code path
and documents the contract for headless consumers. The Keb bridge
honors this contract by always passing `-f` and avoiding
dialog-triggering commands.

[rpc]: https://github.com/earendil-works/pi-coding-agent/blob/main/docs/rpc.md
