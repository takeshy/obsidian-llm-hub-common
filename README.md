# obsidian-llm-hub-common

Chat UI, workflow execution and core services shared by `obsidian-gemini-helper`,
`obsidian-llm-hub`, and `obsidian-local-llm-hub`. The visual baseline is Local LLM Hub. This is an npm
library bundled into each plugin, with no separate Obsidian plugin or runtime
plugin discovery.

## Ownership

Every piece of chat UI belongs here. If the shared stylesheet styles it, this library renders it:
message lists, welcome cards, bubble headers, thinking display, usage display, attachment chips,
tool indicators, composer controls, autocomplete, model search, history lists, chat/input layouts
and the vault tool menu. Shared behavior also belongs here: chat-turn lifecycle, provider stream
processing, tool execution orchestration, workflow execution, history utilities and settings.
Hosts provide SDK clients, provider routing, RAG retrieval policies, Obsidian integrations and UI
callbacks. Their `ChatView` remains the Obsidian integration point.

The `core` entry point owns Gemini chat, Interactions and GenerateContent tool loops, workflow
generation, research polling and image-response processing. SDK calls are injected; native File
Search and pre-retrieved RAG are explicit policies, as are fixed and user-extendable tool limits.
Local Ollama/OpenAI-compatible streams share HTTP framing, request construction, thinking/tool
parsing and inline-tool recovery. OpenCode routing and provider-specific tool execution stay with
their host. Shared tests cover the protocol contracts and both Gemini plugins test their adapters.

Voice belongs here too: dictated-paste submission, reading answers aloud (with the prompt that
asks for a spoken-shaped answer), the microphone button and the conversation with the external
speech-popup app. Hosts supply only the settings values, a way to show an error and the chat id
whose change ends a conversation; process execution goes through `core/nodeModule`, so a mobile
build never loads it.

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

The local transport integration tests bind temporary loopback HTTP servers. They require local
socket access but no external API keys or running model. Real-model and Obsidian checks are still
needed before release.

## Consumer packages

Plugins currently pin prebuilt archives checked into their own `vendor/` directory:

```json
"obsidian-llm-hub-common": "file:vendor/obsidian-llm-hub-common-<version>.tgz"
```

`npm pack` runs the build and tests through `prepack`, and includes compiled ESM,
TypeScript declarations and the MIT license. Consumers can install the archive
with `npm ci --ignore-scripts`; they do not need to compile this library during
installation or have its source repository checked out.

To update a consumer, bump the library version when changing package contents,
build and test the library, commit its source, then create an archive with `npm pack`.
Copy the archive into the intended consumer's `vendor/` directory and update its pin:

```sh
npm install --ignore-scripts --no-audit --no-fund --save-exact ./vendor/obsidian-llm-hub-common-<version>.tgz
```

Record the source commit and archive integrity in the consumer's `vendor/README.md`.
Run that consumer's build, lint and relevant tests, then commit the archive,
dependency, lockfile, provenance and any regenerated styles. Each consumer pins
its own tested package version; a library update does not change other plugins
automatically.

The optional `sync-plugins` script supports Git dependencies instead. It verifies
that the clean local HEAD matches GitHub's `main` and changes the supplied
consumers to that exact Git SHA. It does not update vendored archives. Git installs
require lifecycle scripts so `prepare` can compile the checkout.

## Styles

`styles.css` contains the canonical Local LLM Hub chat styles, with `chat-ui-` as
a class-prefix placeholder. Each consumer edits `styles.source.css` for its
provider features and mobile overrides; `styles.css` in a consumer is generated.
`buildChatStyles` expands the `/* @chat-ui-styles */` marker with the requested
class prefix. The esbuild `chatStylesPlugin` and `import "chat-ui:styles"` register
the source styles and package styles in the development watch graph. CSS stays
in the plugin's usual `styles.css` release artifact.

## External Web search and usage

`createWebSearchSession` and `searchWeb` normalize Tavily and Brave Search results
for function calling. Hosts own provider selection, credential storage, transport
and function-call budgets. `generateWithWebReferences` retrieves search references
before image generation without native grounding.

`fetchTavilyUsage` retrieves account/key credit allowances on demand. Brave quota
windows come from real search response headers without an extra search request.
`addWebSearchUsageSetting` supplies a manual Tavily credits button or passive Brave
remaining-requests row. Hosts must dispose the returned observer when the settings
UI unmounts. Usage snapshots are API-key-scoped and remain in memory only.

## Google grounding and chat storage

Hosts can opt into an irreversible per-conversation
`autoSaveDisabledByGrounding` policy. They obtain confirmation before enabling
Google Search, retain the restriction when search is turned off or providers
change, and display the shared persistent notice. Ordinary and external-search
conversations retain their existing automatic-save behavior.

Restricted conversations skip automatic history writes. Explicit manual saves
write the whole conversation to `getManualChatSaveFolder()`; an empty folder means
the vault root. Re-saving updates the exported note only while its parent matches
the current setting. After a folder change, the next save uses the new destination.
Existing automatic history files are not overwritten by manual exports.

Ordinary manual exports use compact Markdown. Restricted exports retain the
conversation restriction for restoration, but exclude Search Suggestions, search
sources, raw grounding metadata, tool results and provider continuation data.
Manual saving does not re-enable automatic saving. Previously stored metadata is
not migrated or automatically deleted.

Google Search Suggestions are runtime display data, with SDK-neutral extractors
for GenerateContent and Interactions and a shared sandboxed HTML renderer. They
are not persisted in Markdown. Hosts must restrict native grounding to UI paths
that can display Suggestions; source badges alone do not replace them.

## Optional Jev workflow controls

A host that supports Jev can implement `WorkflowHost.getRagSearchOptions(name?)`, returning `{ jevEnabled, searchUntilFound }`. An omitted name means the currently selected index. Command nodes show **Search until an answer is found** only when Jev is active for the selected index. Hosts without this hook keep their existing UI.

The checkbox initially follows the host's saved per-index preference. Changing it saves `ragSearchUntilFound: "true"` or `"false"` in the node properties; reopening the editor preserves that explicit override. When the property is omitted, the host uses its saved preference. The host must apply the override during command execution. Jev credentials, API calls, result filtering, and repeated Top K searches stay in the host; this hook alone does not add Jev support to another Hub.
