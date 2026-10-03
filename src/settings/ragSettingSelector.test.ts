import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RagSettingManager } from "./ragSettings.js";

const ui = vi.hoisted(() => ({
  options: {} as Record<string, string>,
  value: "",
  buttonText: "",
  click: () => {},
  change: (_value: string) => {},
  submit: async (_name: string) => {},
  notice: vi.fn(),
  dropdownAdded: vi.fn(),
}));

vi.mock("obsidian", () => ({
  Modal: class {},
  Notice: class { constructor(message: string) { ui.notice(message); } },
  Setting: class {
    setName() { return this; }
    setDesc() { return this; }
    addDropdown(callback: (dropdown: unknown) => void) {
      ui.dropdownAdded();
      const dropdown = {
        addOption(value: string, label: string) { ui.options[value] = label; return this; },
        setValue(value: string) { ui.value = value; return this; },
        onChange(handler: typeof ui.change) { ui.change = handler; return this; },
      };
      callback(dropdown);
      return this;
    }
    addButton(callback: (button: unknown) => void) {
      callback({
        setButtonText(text: string) { ui.buttonText = text; return this; },
        onClick(handler: typeof ui.click) { ui.click = handler; return this; },
      });
      return this;
    }
  },
}));
vi.mock("./RagSettingNameModal.js", () => ({
  RagSettingNameModal: class {
    constructor(_app: unknown, _title: string, _initial: string, submit: typeof ui.submit) {
      ui.submit = submit;
    }
    open() {}
  },
}));
vi.mock("../i18n/index.js", () => ({ t: (key: string) => key }));

import { addRagSettingSelector } from "./ragSettings.js";

describe("RAG setting selector", () => {
  let plugin: RagSettingManager;
  const display = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    ui.options = {};
    plugin = {
      app: {} as RagSettingManager["app"],
      getRagSettingNames: () => [],
      createRagSetting: vi.fn().mockResolvedValue(undefined),
      selectRagSetting: vi.fn().mockResolvedValue(undefined),
      renameRagSetting: vi.fn(),
      deleteRagSetting: vi.fn(),
    };
  });

  it("offers a blank selection and + New with no saved settings and selects the new setting", async () => {
    addRagSettingSelector({} as HTMLElement, plugin, null, display);
    expect(ui.dropdownAdded).toHaveBeenCalledOnce();
    expect(ui.options).toEqual({ "": "", new: "+ New" });
    expect(ui.value).toBe("");
    ui.change("new");
    await ui.submit("My vault");
    expect(plugin.createRagSetting).toHaveBeenCalledWith("My vault");
    expect(plugin.selectRagSetting).toHaveBeenCalledWith("My vault");
    expect(display).toHaveBeenCalledOnce();
  });

  it("keeps saved settings selectable without a None option", async () => {
    plugin.getRagSettingNames = () => ["My vault", "Other vault"];
    addRagSettingSelector({} as HTMLElement, plugin, "My vault", display);
    expect(ui.dropdownAdded).toHaveBeenCalledOnce();
    expect(ui.options).toEqual({ "setting:My vault": "My vault", "setting:Other vault": "Other vault", new: "+ New" });
    expect(ui.options["setting:My vault"]).toBe("My vault");
    expect(ui.value).toBe("setting:My vault");
    ui.change("setting:Other vault");
    await vi.waitFor(() => expect(display).toHaveBeenCalledOnce());
    expect(plugin.selectRagSetting).toHaveBeenCalledWith("Other vault");
  });

  it("opens creation from + New and preserves selection until a setting is created", async () => {
    plugin.getRagSettingNames = () => ["My vault"];
    addRagSettingSelector({} as HTMLElement, plugin, "My vault", display);
    ui.change("new");
    expect(ui.value).toBe("setting:My vault");
    expect(plugin.selectRagSetting).not.toHaveBeenCalled();
    await ui.submit("New vault");
    expect(plugin.createRagSetting).toHaveBeenCalledWith("New vault");
    expect(plugin.selectRagSetting).toHaveBeenCalledWith("New vault");
    expect(display).toHaveBeenCalledOnce();
  });

  it("reports creation failures without selecting a nonexistent setting", async () => {
    vi.mocked(plugin.createRagSetting).mockRejectedValue(new Error("Already exists"));
    addRagSettingSelector({} as HTMLElement, plugin, null, display);
    ui.change("new");
    await ui.submit("My vault");
    expect(plugin.selectRagSetting).not.toHaveBeenCalled();
    expect(display).not.toHaveBeenCalled();
    expect(ui.notice).toHaveBeenCalledWith("error.failedToCreate");
  });
});
