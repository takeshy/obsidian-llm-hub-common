import { Modal, Notice, Platform, Setting, type App } from "obsidian";
import { cls } from "../core/classPrefix.js";
import { useSettingTextArea } from "./controls.js";
import { formatError } from "../core/error.js";
import type { McpFraming, McpServerConfig, McpTransport } from "../core/mcpTypes.js";
import { joinCommandLine, normalizeSpawnCommand, splitCommandLine } from "../mcp/commandLine.js";
import { createMcpClient, hasMcpStdioClient } from "../mcp/factory.js";
import type { IMcpClient } from "../mcp/httpClient.js";
import { t } from "../i18n/index.js";

/**
 * JSON typed into the headers and env boxes. `JSON.parse(text) as
 * Record<string, string>` is a lie the transport only discovers at request
 * time, so the shape is checked here instead.
 */
export function parseStringRecord(json: string): Record<string, string> {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  const entries = Object.entries(parsed);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) {
    throw new Error("Expected string values");
  }
  return Object.fromEntries(entries);
}

export interface McpServerModalOptions {
  /**
   * Called for the headers and env boxes so a host that keeps their values in a
   * credential store can mark the field as configured elsewhere, rather than
   * show a blank the user would refill. Hosts that store them in settings omit it.
   */
  markSecretField?(setting: Setting, field: "headers" | "env", server: McpServerConfig, text: string): void;
}

/**
 * Editor for one MCP server. The stdio fields appear only where the host
 * registered a stdio client, since createMcpClient refuses a locally spawned
 * server without one: the form cannot offer a transport the plugin would then
 * fail to connect to.
 */
export class McpServerModal extends Modal {
  private server: McpServerConfig;
  private isNew: boolean;
  private options: McpServerModalOptions;
  private onSubmit: (server: McpServerConfig) => void | Promise<void>;
  private headersText = "";
  private envText = "";
  private argsText = "";
  private connectionTested = false;
  private busy = false;
  private testClient: IMcpClient | null = null;
  private saveBtn: import("obsidian").ButtonComponent | null = null;
  private testRequiredEl: HTMLElement | null = null;
  private httpFieldsEl: HTMLElement | null = null;
  private stdioFieldsEl: HTMLElement | null = null;

  constructor(
    app: App,
    server: McpServerConfig | null,
    onSubmit: (server: McpServerConfig) => void | Promise<void>,
    options: McpServerModalOptions = {},
  ) {
    super(app);
    this.isNew = server === null;
    this.options = options;
    // A saved server already listed its tools, so it counts as tested.
    this.connectionTested = server !== null && Array.isArray(server.toolHints) && server.toolHints.length > 0;
    this.server = server
      ? { ...server, allowedTools: [...(server.allowedTools ?? [])] }
      : {
          name: "",
          transport: "http",
          url: "",
          headers: undefined,
          enabled: true,
          toolHints: undefined,
        };
    this.headersText = this.server.headers ? JSON.stringify(this.server.headers, null, 2) : "";
    this.envText = this.server.env ? JSON.stringify(this.server.env, null, 2) : "";
    this.argsText = joinCommandLine(this.server.args || []);
    this.onSubmit = onSubmit;
  }

  /** Anything that changes what we would connect to invalidates the last test. */
  private invalidateConnectionTest(): void {
    this.connectionTested = false;
    this.server.toolHints = undefined;
    this.saveBtn?.setDisabled(true);
    this.testRequiredEl?.removeClass(cls("hidden"));
  }

  private get stdioAvailable(): boolean {
    return hasMcpStdioClient() && !Platform.isMobile;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", {
      text: this.isNew ? t("settings.createMcpServer") : t("settings.editMcpServer"),
    });

    new Setting(contentEl)
      .setName(t("settings.mcpServerName"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.mcpServerName.placeholder"))
          .setValue(this.server.name)
          .onChange((value) => {
            this.server.name = value;
          });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") event.preventDefault();
        });
      });

    new Setting(contentEl)
      .setName(t("settings.mcpAutoApprove"))
      .setDesc(t("settings.mcpAutoApprove.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.server.autoApprove ?? false)
          .onChange((value) => { this.server.autoApprove = value; })
      );

    this.renderAllowedTools(contentEl.createDiv());
    this.renderTransport(contentEl);
    this.renderHttpFields(contentEl);
    this.renderStdioFields(contentEl);
    this.updateFieldVisibility();
    this.renderTestAndActions(contentEl);
  }

  /** Tools the user has already approved for this server; removable, not addable. */
  private renderAllowedTools(allowedEl: HTMLElement): void {
    const render = () => {
      allowedEl.empty();
      new Setting(allowedEl).setName(t("settings.mcpAllowedTools")).setDesc(t("settings.mcpAllowedTools.desc"));
      for (const tool of this.server.allowedTools ?? []) {
        new Setting(allowedEl).setName(tool).addExtraButton((btn) =>
          btn
            .setIcon("trash")
            .setTooltip(t("common.delete"))
            .onClick(() => {
              this.server.allowedTools = this.server.allowedTools?.filter((name) => name !== tool);
              render();
            })
        );
      }
    };
    render();
  }

  private renderTransport(contentEl: HTMLElement): void {
    if (!hasMcpStdioClient()) return;

    new Setting(contentEl)
      .setName(t("settings.mcpTransport"))
      .addDropdown((dropdown) => {
        dropdown.addOption("http", t("settings.mcpTransport.http"));
        if (!Platform.isMobile) dropdown.addOption("stdio", t("settings.mcpTransport.stdio"));
        dropdown.setValue(this.server.transport || "http");
        dropdown.onChange((value) => {
          this.server.transport = value as McpTransport;
          this.invalidateConnectionTest();
          this.updateFieldVisibility();
        });
      });

    if (Platform.isMobile) {
      contentEl.createDiv({ cls: "setting-item-description" })
        .setText(t("settings.mcpTransport.stdioDesktopOnly"));
    }
  }

  private renderHttpFields(contentEl: HTMLElement): void {
    const fields = contentEl.createDiv();
    this.httpFieldsEl = fields;

    new Setting(fields)
      .setName(t("settings.mcpServerUrl"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.mcpServerUrl.placeholder"))
          .setValue(this.server.url || "")
          .onChange((value) => {
            this.server.url = value;
            this.invalidateConnectionTest();
          });
      });

    const headersSetting = new Setting(fields)
      .setName(t("settings.mcpServerHeaders"))
      .setDesc(t("settings.mcpServerHeaders.desc"));
    headersSetting.addTextArea((text) => {
      text
        .setPlaceholder(t("settings.mcpServerHeaders.placeholder"))
        .setValue(this.headersText)
        .onChange((value) => {
          this.headersText = value;
          this.invalidateConnectionTest();
        });
      useSettingTextArea(headersSetting, text.inputEl, 3);
    });
    this.options.markSecretField?.(headersSetting, "headers", this.server, this.headersText);
  }

  private renderStdioFields(contentEl: HTMLElement): void {
    const fields = contentEl.createDiv();
    this.stdioFieldsEl = fields;
    if (!this.stdioAvailable) return;

    new Setting(fields)
      .setName(t("settings.mcpServerCommand"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.mcpServerCommand.placeholder"))
          .setValue(this.server.command || "")
          .onChange((value) => {
            this.server.command = value;
            this.invalidateConnectionTest();
          });
      });

    new Setting(fields)
      .setName(t("settings.mcpServerArgs"))
      .addText((text) => {
        text
          .setPlaceholder(t("settings.mcpServerArgs.placeholder"))
          .setValue(this.argsText)
          .onChange((value) => {
            this.argsText = value;
            this.invalidateConnectionTest();
          });
      });

    new Setting(fields)
      .setName(t("settings.mcpServerFraming"))
      .addDropdown((dropdown) => {
        dropdown.addOption("content-length", t("settings.mcpServerFraming.contentLength"));
        dropdown.addOption("newline", t("settings.mcpServerFraming.newline"));
        dropdown.setValue(this.server.framing || "newline");
        dropdown.onChange((value) => {
          this.server.framing = value as McpFraming;
          this.invalidateConnectionTest();
        });
      });

    const envSetting = new Setting(fields)
      .setName(t("settings.mcpServerEnv"))
      .setDesc(t("settings.mcpServerEnv.desc"));
    envSetting.addTextArea((text) => {
      text
        .setPlaceholder(t("settings.mcpServerEnv.placeholder"))
        .setValue(this.envText)
        .onChange((value) => {
          this.envText = value;
          this.invalidateConnectionTest();
        });
      useSettingTextArea(envSetting, text.inputEl, 3);
    });
    this.options.markSecretField?.(envSetting, "env", this.server, this.envText);
  }

  private renderTestAndActions(contentEl: HTMLElement): void {
    const testSetting = new Setting(contentEl);
    const testStatusEl = testSetting.controlEl.createDiv({ cls: cls("mcp-test-status") });

    testSetting.addButton((btn) =>
      btn
        .setButtonText(t("settings.testMcpConnection"))
        .onClick(() => { void this.testConnection(testStatusEl, btn.buttonEl); })
    );

    this.testRequiredEl = contentEl.createDiv({ cls: cls("mcp-test-required") });
    this.testRequiredEl.setText(t("settings.testConnectionRequired"));
    if (this.connectionTested) this.testRequiredEl.addClass(cls("hidden"));

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText(t("common.cancel")).onClick(() => this.close()))
      .addButton((btn) => {
        this.saveBtn = btn;
        btn
          .setButtonText(this.isNew ? t("common.create") : t("common.save"))
          .setCta()
          .onClick(() => {
            if (this.busy) return;
            if (!this.commitForm()) return;
            void this.saveServer(testStatusEl);
          });
        // A server is only saved once we know it answers.
        btn.setDisabled(!this.connectionTested);
      });
  }

  /** Validate the form and fold it into `server`. Returns false once it has complained. */
  private commitForm(): boolean {
    if (!this.server.name.trim()) {
      new Notice(t("settings.mcpServerNameRequired"));
      return false;
    }

    if (this.useStdio()) {
      if (!this.server.command?.trim()) {
        new Notice(t("settings.mcpServerCommandRequired"));
        return false;
      }
    } else if (!this.server.url?.trim()) {
      new Notice(t("settings.mcpServerUrlRequired"));
      return false;
    }

    if (!this.connectionTested) {
      new Notice(t("settings.testConnectionRequired"));
      return false;
    }

    if (this.useStdio()) {
      this.server.args = splitCommandLine(this.argsText);
      const env = this.parseRecordField(this.envText, "settings.mcpServerInvalidEnv");
      if (env === undefined) return false;
      this.server.env = env || undefined;
    } else {
      const headers = this.parseRecordField(this.headersText, "settings.mcpServerInvalidHeaders");
      if (headers === undefined) return false;
      this.server.headers = headers || undefined;
    }
    return true;
  }

  /** null for an empty box, undefined once the failure has been reported. */
  private parseRecordField(text: string, errorKey: string): Record<string, string> | null | undefined {
    if (!text.trim()) return null;
    try {
      return parseStringRecord(text);
    } catch {
      new Notice(t(errorKey));
      return undefined;
    }
  }

  private useStdio(): boolean {
    return this.stdioAvailable && this.server.transport === "stdio";
  }

  private updateFieldVisibility(): void {
    if (!this.httpFieldsEl || !this.stdioFieldsEl) return;
    const stdio = this.useStdio();
    this.httpFieldsEl.toggleClass(cls("hidden"), stdio);
    this.stdioFieldsEl.toggleClass(cls("hidden"), !stdio);
  }

  /** Disable every control for the duration of an async step, then put it back as it was. */
  private lockControls(): () => void {
    this.busy = true;
    const controls = Array.from(
      this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, button, select, textarea",
      ),
    );
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    return () => {
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      this.busy = false;
      this.saveBtn?.setDisabled(!this.connectionTested);
    };
  }

  private async saveServer(statusEl: HTMLElement): Promise<void> {
    const unlock = this.lockControls();
    try {
      const config = this.useStdio()
        ? { ...this.server, ...normalizeSpawnCommand(this.server.command!, this.server.args || []) }
        : this.server;
      await this.onSubmit(config);
      this.close();
    } catch (error) {
      statusEl.removeClass(cls("mcp-status--success"));
      statusEl.addClass(cls("mcp-status--error"));
      statusEl.setText(t("settings.mcpSaveFailed", { error: formatError(error) }));
    } finally {
      unlock();
    }
  }

  private async testConnection(statusEl: HTMLElement, btnEl: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    const unlock = this.lockControls();
    this.invalidateConnectionTest();
    statusEl.empty();
    statusEl.removeClass(cls("mcp-status--success"), cls("mcp-status--error"));
    statusEl.setText(t("settings.mcpChecking"));
    btnEl.textContent = t("settings.mcpChecking");
    btnEl.disabled = true;

    const fail = (message: string) => {
      statusEl.addClass(cls("mcp-status--error"));
      statusEl.setText(message);
      btnEl.disabled = false;
    };

    let client: IMcpClient | null = null;
    try {
      let testConfig: McpServerConfig;
      if (this.useStdio()) {
        if (!this.server.command?.trim()) return fail(t("settings.mcpServerCommandRequired"));
        const env = this.parseRecordFieldForTest(this.envText);
        if (env === undefined) return fail(t("settings.mcpServerInvalidEnv"));
        testConfig = {
          name: this.server.name || "test",
          transport: "stdio",
          url: "",
          ...normalizeSpawnCommand(this.server.command, splitCommandLine(this.argsText)),
          env: env || undefined,
          framing: this.server.framing || "newline",
          enabled: true,
        };
      } else {
        const headers = this.parseRecordFieldForTest(this.headersText);
        if (headers === undefined) return fail(t("settings.mcpServerInvalidHeaders"));
        testConfig = {
          name: this.server.name || "test",
          transport: "http",
          url: this.server.url,
          headers: headers || undefined,
          enabled: true,
        };
      }

      client = createMcpClient(testConfig);
      this.testClient = client;

      await client.initialize();
      const tools = await client.listTools();

      // The names are kept so the server can be edited later without connecting again.
      const toolNames = tools.map((tool) => tool.name);
      this.server.toolHints = toolNames;
      this.saveBtn?.setDisabled(false);
      this.connectionTested = true;
      this.testRequiredEl?.addClass(cls("hidden"));

      statusEl.addClass(cls("mcp-status--success"));
      statusEl.empty();
      statusEl.createDiv({ cls: cls("mcp-tools-count") })
        .setText(t("settings.mcpConnectionSuccess", { count: String(tools.length) }));
      if (tools.length > 0) {
        statusEl.createDiv({ cls: cls("mcp-tools-list") }).setText(toolNames.join(", "));
      }
    } catch (error) {
      this.connectionTested = false;
      this.server.toolHints = undefined;
      this.saveBtn?.setDisabled(true);
      this.testRequiredEl?.removeClass(cls("hidden"));
      statusEl.addClass(cls("mcp-status--error"));
      statusEl.setText(t("settings.mcpConnectionFailed", { error: formatError(error) }));
    } finally {
      await client?.close().catch(() => {});
      this.testClient = null;
      btnEl.textContent = t("settings.testMcpConnection");
      unlock();
    }
  }

  /** undefined for invalid JSON, null for an empty box. */
  private parseRecordFieldForTest(text: string): Record<string, string> | null | undefined {
    if (!text.trim()) return null;
    try {
      return parseStringRecord(text);
    } catch {
      return undefined;
    }
  }

  onClose() {
    // A test still in flight would otherwise keep its process or socket open.
    void this.testClient?.close().catch(() => {});
    this.contentEl.empty();
  }
}
