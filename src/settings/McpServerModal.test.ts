import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServerModal, parseStringRecord } from "./McpServerModal.js";

const state = vi.hoisted(() => ({
  controls: [] as { disabled: boolean }[],
  initialize: vi.fn(),
  listTools: vi.fn(),
  close: vi.fn(),
  config: undefined as unknown,
  stdio: true,
}));

vi.mock("obsidian", () => ({
  Modal: class {
    contentEl = { querySelectorAll: () => state.controls, empty: vi.fn(), createEl: vi.fn(), createDiv: vi.fn() };
    close = vi.fn();
  },
  Setting: class {}, Notice: class {}, Platform: { isMobile: false },
}));
vi.mock("../mcp/factory.js", () => ({
  hasMcpStdioClient: () => state.stdio,
  createMcpClient: (config: unknown) => {
    state.config = config;
    return { initialize: state.initialize, listTools: state.listTools, close: state.close };
  },
}));
vi.mock("../i18n/index.js", () => ({ t: (key: string, args?: unknown) => key + (args ? JSON.stringify(args) : "") }));

function status() {
  return {
    empty: vi.fn(), removeClass: vi.fn(), addClass: vi.fn(), setText: vi.fn(),
    createDiv: () => ({ setText: vi.fn() }),
  } as unknown as HTMLElement;
}

function modal(onSubmit = vi.fn(async () => {})) {
  return new McpServerModal({} as never, {
    name: "test", transport: "stdio", url: "", enabled: true,
    command: '"C:\\Program Files\\node.exe" "C:\\app dir\\server.js"', args: ["--path", "a b"], toolHints: ["old"],
  }, onSubmit);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.controls = [{ disabled: false }, { disabled: true }];
  state.stdio = true;
  state.initialize.mockResolvedValue({});
  state.listTools.mockResolvedValue([{ name: "addCard" }]);
  state.close.mockResolvedValue(undefined);
});

describe("MCP connection settings", () => {
  it("locks controls during testing and restores them after normalized connection succeeds", async () => {
    let finish!: () => void;
    state.initialize.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const instance = modal();
    const button = { disabled: false, textContent: "Test" } as HTMLButtonElement;
    const pending = instance["testConnection"](status(), button);
    expect(state.controls.every(control => control.disabled)).toBe(true);
    expect(button.textContent).toBe("settings.mcpChecking");
    expect(state.config).toMatchObject({
      command: "C:\\Program Files\\node.exe",
      args: ["C:\\app dir\\server.js", "--path", "a b"],
    });
    finish();
    await pending;
    expect(state.controls.map(control => control.disabled)).toEqual([false, true]);
    expect(instance["connectionTested"]).toBe(true);
    expect(state.close).toHaveBeenCalled();
  });

  it("shows a failed check without closing the modal or allowing save", async () => {
    state.initialize.mockRejectedValue(new Error("spawn ENOENT"));
    const instance = modal();
    const output = status();
    await instance["testConnection"](output, {} as HTMLButtonElement);
    expect(output.setText).toHaveBeenCalledWith(expect.stringContaining("ENOENT"));
    expect(instance["connectionTested"]).toBe(false);
    expect(instance.close).not.toHaveBeenCalled();
    expect(state.close).toHaveBeenCalled();
  });

  it("keeps the form available when saving fails", async () => {
    const onSubmit = vi.fn(async () => { throw new Error("disk full"); });
    const instance = modal(onSubmit);
    const output = status();
    await instance["saveServer"](output);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      command: "C:\\Program Files\\node.exe",
      args: ["C:\\app dir\\server.js", "--path", "a b"],
    }));
    expect(output.setText).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    expect(instance.close).not.toHaveBeenCalled();
    expect(state.controls[0].disabled).toBe(false);
  });

  it("connects over HTTP where the host registered no stdio client, whatever the config says", async () => {
    // The transport row is not even drawn there, so a server saved as stdio
    // elsewhere must not be handed to a factory that would refuse it.
    state.stdio = false;
    const instance = modal();
    instance["server"].url = "https://mcp.example/rpc";
    await instance["testConnection"](status(), {} as HTMLButtonElement);
    expect(state.config).toMatchObject({ transport: "http", url: "https://mcp.example/rpc" });
  });
});

describe("parseStringRecord", () => {
  it("accepts an object of strings", () => {
    expect(parseStringRecord('{"Authorization": "Bearer x"}')).toEqual({ Authorization: "Bearer x" });
  });

  it("refuses JSON the transport would only choke on later", () => {
    // `JSON.parse(text) as Record<string, string>` accepted all of these.
    expect(() => parseStringRecord('["Authorization"]')).toThrow();
    expect(() => parseStringRecord('"Bearer x"')).toThrow();
    expect(() => parseStringRecord('{"timeout": 30}')).toThrow();
    expect(() => parseStringRecord("null")).toThrow();
  });
});
