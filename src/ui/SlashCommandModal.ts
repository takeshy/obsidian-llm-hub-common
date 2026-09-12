import { Modal, Notice, Setting, type App } from "obsidian";
import { cls } from "../core/classPrefix.js";
import type { SearchSelection } from "../core/events.js";
import type { VaultToolMode } from "../core/vaultTools.js";
import { t } from "../i18n/index.js";

/**
 * The fields this modal edits. A host's own command type carries these plus
 * whatever else it stores; everything it does not know about is copied through
 * untouched.
 */
export interface SlashCommandDraft {
  id: string;
  name: string;
  promptTemplate: string;
  description?: string;
  model?: string | null;
  /** null = keep the chat's current search sources. */
  searchSelection?: SearchSelection | null;
  /** Pre-split single choice, still read from stored commands. */
  searchSetting?: string | null;
  confirmEdits?: boolean;
  /** null = keep the chat's current Vault access mode. */
  vaultToolMode?: VaultToolMode | null;
  /** null = do not change the chat's selected skills. */
  skillPath?: string | null;
  /** null = keep the chat's current servers, [] = all off. */
  enabledMcpServers?: string[] | null;
}

/**
 * What this host lets a slash command override. Each group is optional because
 * a host may genuinely lack the capability — local-llm-hub runs one configured
 * model, so it has no model row to show — but the fields inside a group are
 * required, so a host that does offer the capability cannot half-declare it.
 */
export interface SlashCommandModalOptions {
  /** Models offered as a per-command override. Omit where the host runs one configured model. */
  models?: { name: string; displayName: string }[];
  /** Search sources a command may pin. Omit where slash commands cannot override search. */
  search?: {
    /** Offer Web search as a source. */
    webSearch: boolean;
    /** RAG index names. Empty = the host has RAG but nothing is configured. */
    ragSettings: string[];
    /**
     * Whether this host's composer can hold Web search and a RAG index at the
     * same time. A host whose composer still clears one when the other is
     * picked passes false and is offered no "Web + index" entries, because a
     * command pinning both would lose one of them the moment it ran.
     */
    combinable: boolean;
  };
  /** MCP servers a command may narrow to. Omit where the host has no MCP support. */
  mcpServers?: { name: string; enabled: boolean }[];
  /** Skills a command may automatically select. */
  skills?: { name: string; folderPath: string }[];
  /** Offer the per-command edit-confirmation toggle. Omit where the host always confirms. */
  editConfirmation?: boolean;
}

const KEEP_CURRENT = "__current__";
const NO_SEARCH = "__none__";
const WEB_ONLY = "__web__";

/**
 * Encode a Web/RAG pair into one dropdown value, so Obsidian's settings UI stays
 * one row. The index name is percent-encoded: names may contain the ":" the
 * prefix is separated by.
 */
export function encodeSearchSelection(selection: SearchSelection | null | undefined): string {
  if (selection === null || selection === undefined) return KEEP_CURRENT;
  if (selection.ragSetting) {
    return `${selection.webSearch ? "both" : "rag"}:${encodeURIComponent(selection.ragSetting)}`;
  }
  return selection.webSearch ? WEB_ONLY : NO_SEARCH;
}

export function decodeSearchSelection(value: string): SearchSelection | null {
  if (value === KEEP_CURRENT) return null;
  if (value === NO_SEARCH) return { webSearch: false, ragSetting: null };
  if (value === WEB_ONLY) return { webSearch: true, ragSetting: null };
  const separator = value.indexOf(":");
  return {
    webSearch: value.slice(0, separator) === "both",
    ragSetting: decodeURIComponent(value.slice(separator + 1)),
  };
}

/**
 * A new command carries only the fields this host can edit, so a plugin without
 * MCP never writes an enabledMcpServers key it would then ignore.
 */
export function createBlankSlashCommand(options: SlashCommandModalOptions): SlashCommandDraft {
  const draft: SlashCommandDraft = {
    id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    promptTemplate: "",
    description: "",
    vaultToolMode: null,
  };
  if (options.models) draft.model = null;
  if (options.search) draft.searchSelection = null;
  if (options.mcpServers) draft.enabledMcpServers = null;
  if (options.skills) draft.skillPath = null;
  return draft;
}

/**
 * Editor for one slash command, shared by every plugin so the rows, the stored
 * sentinels and the validation stay identical. The rows a host does not declare
 * are simply not rendered, and the corresponding field is left untouched.
 */
export class SlashCommandModal<T extends SlashCommandDraft> extends Modal {
  private command: T;
  private isNew: boolean;
  private options: SlashCommandModalOptions;
  private onSubmit: (command: T) => void | Promise<void>;

  constructor(
    app: App,
    command: T | null,
    options: SlashCommandModalOptions,
    onSubmit: (command: T) => void | Promise<void>,
  ) {
    super(app);
    this.isNew = command === null;
    this.options = options;
    this.onSubmit = onSubmit;
    // The cast is the one place the shared draft meets the host's command type;
    // every field beyond the three required ones means "keep the current setting".
    this.command = command ? { ...command } : createBlankSlashCommand(options) as T;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", {
      text: this.isNew ? t("settings.createSlashCommand") : t("settings.editSlashCommand"),
    });

    this.renderName(contentEl);
    this.renderDescription(contentEl);
    this.renderPromptTemplate(contentEl);
    if (this.options.models) this.renderModel(contentEl, this.options.models);
    if (this.options.search) this.renderSearch(contentEl, this.options.search);
    if (this.options.editConfirmation) this.renderEditConfirmation(contentEl);
    this.renderVaultToolMode(contentEl);
    if (this.options.skills) this.renderSkill(contentEl, this.options.skills);
    if (this.options.mcpServers?.length) this.renderMcpServers(contentEl, this.options.mcpServers);
    this.renderActions(contentEl);
  }

  private renderName(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName(t("settings.commandName"))
      .setDesc(t("settings.commandName.desc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.commandName.placeholder"))
          .setValue(this.command.name)
          .onChange((value) => {
            // The name is typed after a slash, so spaces and punctuation are dropped.
            this.command.name = value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
          });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") event.preventDefault();
        });
      });
  }

  private renderDescription(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName(t("settings.description"))
      .setDesc(t("settings.description.desc"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.description.placeholder"))
          .setValue(this.command.description || "")
          .onChange((value) => {
            this.command.description = value;
          });
      });
  }

  private renderPromptTemplate(contentEl: HTMLElement): void {
    const setting = new Setting(contentEl)
      .setName(t("settings.promptTemplate"))
      .setDesc(t("settings.promptTemplate.desc"));
    setting.settingEl.addClass(cls("settings-textarea-container"));
    setting.addTextArea((text) => {
      text
        .setPlaceholder(t("settings.promptTemplate.placeholder"))
        .setValue(this.command.promptTemplate)
        .onChange((value) => {
          this.command.promptTemplate = value;
        });
      text.inputEl.rows = 6;
      text.inputEl.addClass(cls("settings-textarea"));
    });
  }

  private renderModel(contentEl: HTMLElement, models: { name: string; displayName: string }[]): void {
    new Setting(contentEl)
      .setName(t("settings.modelOptional"))
      .setDesc(t("settings.modelOptional.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", t("settings.useCurrentModel"));
        // A command pinned to a model the host no longer offers falls back to the current one.
        if (!models.some((model) => model.name === this.command.model)) this.command.model = null;
        models.forEach((model) => dropdown.addOption(model.name, model.displayName));
        dropdown.setValue(this.command.model || "");
        dropdown.onChange((value) => {
          this.command.model = value || null;
        });
      });
  }

  private renderSearch(contentEl: HTMLElement, search: NonNullable<SlashCommandModalOptions["search"]>): void {
    new Setting(contentEl)
      .setName(t("settings.searchOptional"))
      .setDesc(t("settings.searchOptional.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption(KEEP_CURRENT, t("settings.useCurrentSetting"));
        dropdown.addOption(NO_SEARCH, t("common.none"));
        if (search.webSearch) dropdown.addOption(WEB_ONLY, t("input.webSearch"));
        search.ragSettings.forEach((name) => {
          const encoded = encodeURIComponent(name);
          dropdown.addOption(`rag:${encoded}`, t("input.rag", { name }));
          if (search.webSearch && search.combinable) {
            dropdown.addOption(`both:${encoded}`, `${t("input.webSearch")} + ${name}`);
          }
        });
        dropdown.setValue(encodeSearchSelection(this.command.searchSelection));
        dropdown.onChange((value) => {
          this.command.searchSelection = decodeSearchSelection(value);
          // The pre-split value would otherwise win on the next read.
          if (this.command.searchSetting !== undefined) this.command.searchSetting = undefined;
        });
      });
  }

  private renderEditConfirmation(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName(t("settings.confirmEdits"))
      .setDesc(t("settings.confirmEdits.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.command.confirmEdits !== false)
          .onChange((value) => {
            this.command.confirmEdits = value;
          })
      );
  }

  private renderVaultToolMode(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName(t("settings.vaultToolModeOptional"))
      .setDesc(t("settings.vaultToolModeOptional.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption(KEEP_CURRENT, t("settings.useCurrentSetting"));
        dropdown.addOption("all", t("input.vaultToolAll"));
        dropdown.addOption("noSearch", t("input.vaultToolNoSearch"));
        dropdown.addOption("readOnly", t("input.vaultToolReadOnly"));
        dropdown.addOption("none", t("input.vaultToolNone"));
        dropdown.setValue(this.command.vaultToolMode ?? KEEP_CURRENT);
        dropdown.onChange((value) => {
          this.command.vaultToolMode = value === KEEP_CURRENT ? null : value as VaultToolMode;
        });
      });
  }

  private renderSkill(contentEl: HTMLElement, skills: { name: string; folderPath: string }[]): void {
    new Setting(contentEl)
      .setName(t("settings.skillOptional"))
      .setDesc(t("settings.skillOptional.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption(KEEP_CURRENT, t("settings.keepCurrentSkills"));
        if (!skills.some(skill => skill.folderPath === this.command.skillPath)) this.command.skillPath = null;
        skills.forEach(skill => dropdown.addOption(skill.folderPath, skill.name));
        dropdown.setValue(this.command.skillPath ?? KEEP_CURRENT);
        dropdown.onChange((value) => {
          this.command.skillPath = value === KEEP_CURRENT ? null : value;
        });
      });
  }

  private renderMcpServers(contentEl: HTMLElement, servers: { name: string; enabled: boolean }[]): void {
    new Setting(contentEl)
      .setName(t("settings.mcpServersOptional"))
      .setDesc(t("settings.mcpServersOptional.desc"));

    const container = contentEl.createDiv({ cls: cls("mcp-checkboxes") });
    const currentSettingLabel = container.createEl("label", { cls: cls("mcp-checkbox-label") });
    const currentSettingCheckbox = currentSettingLabel.createEl("input", { type: "checkbox" });
    const usesCurrent = () => this.command.enabledMcpServers === null || this.command.enabledMcpServers === undefined;
    currentSettingCheckbox.checked = usesCurrent();
    currentSettingLabel.appendText(t("settings.useCurrentSetting"));

    const serverCheckboxes = container.createDiv({ cls: cls("mcp-server-checkboxes") });
    const enabledServers = new Set<string>(this.command.enabledMcpServers || []);

    const updateVisibility = () => {
      serverCheckboxes.style.display = currentSettingCheckbox.checked ? "none" : "block";
    };
    updateVisibility();

    servers.forEach((server) => {
      const label = serverCheckboxes.createEl("label", { cls: cls("mcp-checkbox-label") });
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = usesCurrent() ? server.enabled : enabledServers.has(server.name);
      label.appendText(server.name);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) enabledServers.add(server.name);
        else enabledServers.delete(server.name);
        this.command.enabledMcpServers = Array.from(enabledServers);
      });
    });

    currentSettingCheckbox.addEventListener("change", () => {
      if (currentSettingCheckbox.checked) {
        this.command.enabledMcpServers = null;
      } else {
        // Start from what the host has enabled now, so unticking "use current"
        // does not silently turn every server off.
        const defaultEnabled = servers.filter((server) => server.enabled).map((server) => server.name);
        enabledServers.clear();
        defaultEnabled.forEach((name) => enabledServers.add(name));
        this.command.enabledMcpServers = defaultEnabled;
        serverCheckboxes.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((box, index) => {
          box.checked = enabledServers.has(servers[index].name);
        });
      }
      updateVisibility();
    });
  }

  private renderActions(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText(this.isNew ? t("common.create") : t("common.save"))
          .setCta()
          .onClick(() => {
            if (!this.command.name.trim()) {
              new Notice(t("settings.commandName.required"));
              return;
            }
            if (!this.command.promptTemplate.trim()) {
              new Notice(t("settings.promptTemplate.required"));
              return;
            }
            void this.onSubmit(this.command);
            this.close();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
