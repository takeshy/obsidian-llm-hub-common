# obsidian-llm-hub-chat-ui

React chat UI shared by `obsidian-gemini-helper`, `obsidian-llm-hub`, and
`obsidian-local-llm-hub`. The visual baseline is Local LLM Hub. This is an npm
library bundled into each plugin, with no separate Obsidian plugin or runtime
plugin discovery.

## Ownership

The library owns message lists, welcome cards, bubble headers, thinking display,
usage display, attachment chips, tool indicators, composer controls, autocomplete,
model search, history lists and chat/input layouts. Its inputs are presentation
data, callbacks and React slots. It does not import Obsidian, a plugin class, an
LLM SDK, settings, translation modules or persistence code.

Hosts own streaming and cancellation, tool execution, RAG citation resolution,
Markdown rendering and cleanup, history storage/encryption, file handling,
provider-specific settings, CLI terminals, and their translations. Their existing
`ChatView` remains the Obsidian integration point. `Chat.tsx`, `InputArea.tsx` and
`MessageBubble.tsx` are host controllers/adapters; provider extensions enter via
slots instead of plugin-name branches in this library.

`react` and `lucide-react` are peer dependencies, so consumers bundle their own
single React instance. The package ships compiled ESM and TypeScript declarations.

## Mobile

`Composer.collapse`, `InputArea.collapsed` and `CollapsedInput` provide optional
collapse/expand controls. Gemini Helper retains its existing mobile behavior,
keyboard handling and mobile CSS. Draft and attachment state stays in the host,
so hiding the composer does not clear it. Local LLM Hub has no collapse toggle.

## Build and verify

```sh
npm ci
npm run build
npm test
npm pack
```

Each plugin pins a full commit SHA from this GitHub repository:

```json
"obsidian-llm-hub-chat-ui": "git+https://github.com/takeshy/obsidian-llm-hub-chat-ui.git#<full-commit-sha>"
```

On installation, npm runs `prepare` to compile the Git checkout into `dist/`.
The generated ESM and declarations are included in the installed package; they
are not tracked in Git. Registry publication and checked-in tarballs are not
needed. Consumers can run `npm ci` from a standalone checkout. Lifecycle scripts
must be enabled for Git dependency preparation.

For subsequent updates, build and test the library, commit and push it to `main`,
then synchronize the consumers from that clean commit:

```sh
npm run build
npm test
git add <changed-files>
git commit -m "Describe the library change"
git push origin main
npm run sync-plugins -- ../obsidian-gemini-helper ../obsidian-llm-hub ../obsidian-local-llm-hub
```

The sync script verifies that the clean local HEAD matches GitHub's `main`, then
updates each consumer's dependency and lockfile to that exact SHA. It runs npm
with lifecycle scripts enabled so `prepare` generates the package's build output.
Run each consumer's build, lint and relevant tests afterward, then commit its
`package.json`, `package-lock.json` and any regenerated styles. A version bump is
optional for Git-only updates because the full SHA identifies the exact source.

## Styles

`styles.css` contains the canonical Local LLM Hub chat styles, with `chat-ui-` as
a class-prefix placeholder. Each consumer edits `styles.source.css` for its
provider features and mobile overrides; `styles.css` in a consumer is generated.
`buildChatStyles` expands the `/* @chat-ui-styles */` marker with the requested
class prefix. The esbuild `chatStylesPlugin` and `import "chat-ui:styles"` register
the source styles and package styles in the development watch graph. CSS stays
in the plugin's usual `styles.css` release artifact.
