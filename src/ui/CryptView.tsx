import { cls } from "../core/classPrefix.js";
import { workflowHost } from "../workflow/host.js";
import { createRoot, Root } from "react-dom/client";
import { TextFileView, WorkspaceLeaf, IconName, Notice } from "obsidian";
import CryptEditor from "./CryptEditor.js";
import type { PluginRuntime } from "../plugin/host.js";
import {
  isEncryptedFile,
  encryptPlaintextFileContent,
  type EncryptedFileMetadata,
} from "../core/index.js";
import { formatError } from "../core/index.js";

export const CRYPT_VIEW_TYPE = "hub-crypt-view";

export class CryptView extends TextFileView {
  plugin: PluginRuntime;
  reactRoot: Root | null = null;
  private currentData: string = "";

  constructor(leaf: WorkspaceLeaf, plugin: PluginRuntime) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CRYPT_VIEW_TYPE;
  }

  getDisplayText(): string {
    const fileName = this.file?.name || "Encrypted";
    return fileName;
  }

  getIcon(): IconName {
    return "lock";
  }

  // TextFileView required methods
  getViewData(): string {
    return this.currentData;
  }

  setViewData(data: string, clear: boolean): void {
    this.currentData = data;
    if (clear) {
      this.reactRoot?.unmount();
      this.reactRoot = null;
    }
    this.renderContent();
  }

  clear(): void {
    this.currentData = "";
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.empty();
  }

  private renderContent(): void {
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }

    const container = this.contentEl;
    container.empty();
    container.addClass(cls("crypt-container"));

    if (!this.currentData) {
      container.createDiv({
        text: "No content",
        cls: cls("crypt-error"),
      });
      return;
    }

    if (!isEncryptedFile(this.currentData)) {
      container.createDiv({
        text: "File is not encrypted",
        cls: cls("crypt-error"),
      });
      return;
    }

    const filePath = this.file?.path || "";

    const root = createRoot(container);
    root.render(
      <CryptEditor
        plugin={this.plugin}
        filePath={filePath}
        encryptedContent={this.currentData}
        onSave={async (newContent: string, metadata: EncryptedFileMetadata) => {
          await this.saveEncrypted(newContent, metadata);
        }}
        onDecrypt={async (decryptedContent: string) => {
          await this.saveDecrypted(decryptedContent);
        }}
      />
    );
    this.reactRoot = root;
  }

  async onClose(): Promise<void> {
    this.reactRoot?.unmount();
    await Promise.resolve();
  }

  private async saveEncrypted(content: string, metadata: EncryptedFileMetadata): Promise<void> {
    if (!this.file) return;

    const encryption = workflowHost().getHistoryEncryption();
    if (!encryption?.publicKey || !encryption?.encryptedPrivateKey || !encryption?.salt) {
      new Notice("Encryption not configured");
      return;
    }

    try {
      const encryptedContent = await encryptPlaintextFileContent(
        content,
        encryption.publicKey,
        encryption.encryptedPrivateKey,
        encryption.salt,
        metadata,
      );
      this.currentData = encryptedContent;
      this.requestSave();
      new Notice("File saved (encrypted)");
    } catch (error) {
      console.error("Failed to save encrypted file:", formatError(error));
      new Notice("Failed to save file");
    }
  }

  private async saveDecrypted(content: string): Promise<void> {
    if (!this.file) return;

    try {
      this.currentData = content;
      this.requestSave();

      // Remove .encrypted extension if present
      let openPath = this.file.path;
      if (this.file.path.endsWith(".encrypted")) {
        const newPath = this.file.path.slice(0, -".encrypted".length);
        await this.plugin.app.vault.rename(this.file, newPath);
        openPath = newPath;
      }

      new Notice("File decrypted and saved");

      // Close this view and open the file normally
      this.leaf.detach();
      await this.plugin.app.workspace.openLinkText(openPath, "", false);
    } catch (error) {
      console.error("Failed to save decrypted file:", formatError(error));
      new Notice("Failed to decrypt file");
    }
  }
}
