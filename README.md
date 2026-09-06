# obsidian-llm-hub-common

React chat UI shared by `obsidian-gemini-helper`, `obsidian-llm-hub`, and
`obsidian-local-llm-hub`. The visual baseline is Local LLM Hub. This is an npm
library bundled into each plugin, with no separate Obsidian plugin or runtime
plugin discovery.

## Ownership

Every piece of chat UI belongs here. If the shared stylesheet styles it, this library renders it:
message lists, welcome cards, bubble headers, thinking display, usage display, attachment chips,
tool indicators, composer controls, autocomplete, model search, history lists, chat/input layouts
and the vault tool menu. Hosts keep only behavior: streaming and cancellation, tool execution, RAG
retrieval, Markdown rendering, history storage/encryption, file handling, provider settings and
their translations. Their `ChatView` remains the Obsidian integration point, and `Chat.tsx`,
`InputArea.tsx` and `MessageBubble.tsx` are thin adapters that hold state and pass callbacks.

Plugin features are unified rather than branched. When the same feature exists in more than one
generation across the plugins, the newest one wins and the others adopt it; a shared component does
not grow an option to preserve an older variant. Options exist only for capabilities a host cannot
have at all.

Two rules keep the three plugins from drifting apart again, and both are enforced, not documented:

- **Missing text is a type error.** Presentation props that carry meaning are required, never
  optional, and the library ships no default strings. `VaultToolOption.description` is the model:
  a host cannot render a mode without explaining it. Hosts map their own i18n keys into these props,
  so key-naming differences between plugins stay in the host adapter.
- **Duplicated markup fails a test.** `obsidian-llm-hub-common/check-markup` scans a plugin's
  sources for classes the shared stylesheet defines. Each plugin runs it in
  `src/ui/components/sharedMarkup.test.ts` with an allowlist of UI it still renders itself. That
  allowlist only shrinks: a second test fails once an entry no longer appears, and new entries are
  never added to make a component pass.

`react` and `lucide-react` are peer dependencies, so consumers bundle their own
single React instance. The package ships compiled ESM and TypeScript declarations.

## Mobile

`Composer.collapse`, `InputArea.collapsed` and `CollapsedInput` provide the
collapse/expand controls. Hosts keep their own keyboard handling and mobile CSS,
and pass state-driven class names through `modifiers` (`ChatLayout` and
`InputArea` build the shared class themselves). Draft and attachment state stays
in the host, so hiding the composer does not clear it.

## Build and verify

```sh
npm ci
npm run build
npm test
npm pack
```

Each plugin pins a full commit SHA from this GitHub repository:

```json
"obsidian-llm-hub-common": "git+https://github.com/takeshy/obsidian-llm-hub-common.git#<full-commit-sha>"
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
