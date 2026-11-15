import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProgressBackup } from "../backup/progressBackup";
import { STORAGE_KEY } from "../config";
import { DEFAULT_PROGRESS } from "../storage";
import type { SyncSnapshot } from "../sync/types";
import {
  writeSyncRecovery,
  type SyncRecoveryRecord,
} from "../sync/storage";
import { SyncSettings } from "./SyncSettings";
import type { ClientSyncController } from "../sync/useClientSync";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const backupMocks = vi.hoisted(() => ({
  exportBackup: vi.fn(async (_progress: unknown) => {}),
  isBackupCancelled: vi.fn(() => false),
}));

vi.mock("../backup/progressBackup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../backup/progressBackup")>();
  return {
    ...actual,
    exportBackup: backupMocks.exportBackup,
    isBackupCancelled: backupMocks.isBackupCancelled,
  };
});

interface FakeController extends ClientSyncController {
  setSnapshot(next: SyncSnapshot): void;
  emit(): void;
}

function snapshot(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    status: "idle",
    config: null,
    message: "",
    lastSyncedAt: null,
    conflict: null,
    ...overrides,
  };
}

function createController(initial: SyncSnapshot): FakeController {
  let current = initial;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  const controller: FakeController = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => current,
    initialize: vi.fn(async () => {}),
    configure: vi.fn(async (settings, password) => {
      current = snapshot({
        ...current,
        status: "idle",
        config: {
          ...settings,
          hasPassword: Boolean(password) || current.config?.hasPassword === true,
        },
      });
      emit();
    }),
    disconnect: vi.fn(async () => {
      current = snapshot({ status: "idle" });
      emit();
    }),
    sync: vi.fn(async () => {
      current = snapshot({
        ...current,
        status: "synced",
        message: "",
        lastSyncedAt: "2026-11-15T10:20:00",
      });
      emit();
    }),
    resolveConflict: vi.fn(async () => {
      current = snapshot({
        ...current,
        status: "synced",
        conflict: null,
        lastSyncedAt: "2026-11-15T11:00:00",
      });
      emit();
    }),
    notifyLocalChange: vi.fn(),
    dispose: vi.fn(),
    setSnapshot(next) {
      current = next;
      emit();
    },
    emit,
  };

  return controller;
}

const CONNECTED = {
  url: "https://dav.example.com/fge",
  username: "yandi",
  autoSync: true,
  hasPassword: true,
};

const LOCAL_BACKUP: ProgressBackup = {
  format: "fge-progress",
  version: 1,
  edition: __FGE_EDITION__,
  exportedAt: "2026-11-14T08:00:00.000Z",
  progress: {
    ...DEFAULT_PROGRESS,
    xp: 120,
    lessons: {
      "c01-l01": { completed: true, stars: 3 },
      "c01-l02": { completed: true, stars: 1 },
    },
  },
};

const REMOTE_BACKUP: ProgressBackup = {
  format: "fge-progress",
  version: 1,
  edition: __FGE_EDITION__,
  exportedAt: "2026-11-15T09:30:00.000Z",
  progress: {
    ...DEFAULT_PROGRESS,
    xp: 480,
    lessons: {
      "c01-l01": { completed: true, stars: 3 },
      "c01-l02": { completed: true, stars: 3 },
      "c01-l03": { completed: true, stars: 2 },
      "c01-l04": { completed: true, stars: 1 },
    },
  },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  backupMocks.exportBackup.mockReset();
  backupMocks.exportBackup.mockResolvedValue(undefined);
  backupMocks.isBackupCancelled.mockReset();
  backupMocks.isBackupCancelled.mockReturnValue(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const $ = <T extends HTMLElement>(selector: string) =>
  container.querySelector(selector) as T | null;

function input(selector: string): HTMLInputElement {
  const element = $(selector) as HTMLInputElement | null;
  if (!element) throw new Error(`input not found: ${selector}`);
  return element;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text)
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

function render(controller: ClientSyncController | null) {
  act(() => root.render(<SyncSettings controller={controller} />));
}

function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function submitForm() {
  const form = $("form");
  if (!form) throw new Error("sync form not found");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function seedRecovery(
  account = CONNECTED,
  remote = true,
  savedAt = "2026-11-15T09:40:00",
  localXp = 120,
  reason: SyncRecoveryRecord["reason"] = "conflict"
) {
  writeSyncRecovery(
    localStorage,
    { url: account.url, username: account.username },
    {
      savedAt,
      reason,
      local: {
        ...LOCAL_BACKUP,
        progress: { ...LOCAL_BACKUP.progress, xp: localXp },
      },
      remote: remote ? REMOTE_BACKUP : null,
    }
  );
}

function typeConnection(
  values: { url?: string; username?: string; password?: string } = {}
) {
  if (values.url !== undefined) setValue(input("#sync-url"), values.url);
  if (values.username !== undefined) {
    setValue(input("#sync-username"), values.username);
  }
  if (values.password !== undefined) {
    setValue(input("#sync-password"), values.password);
  }
}

describe("SyncSettings 可见性", () => {
  test("网页版没有 controller 时整段同步设置不渲染", () => {
    const controller = createController(snapshot());
    render(null);
    expect(container.innerHTML).toBe("");
    expect(controller.configure).not.toHaveBeenCalled();
  });
});

describe("SyncSettings 连接配置", () => {
  test("已有配置回填地址、用户名和自动同步，密码输入保持空白", () => {
    render(createController(snapshot({ config: CONNECTED })));

    expect(input("#sync-url").value).toBe(CONNECTED.url);
    expect(input("#sync-username").value).toBe(CONNECTED.username);
    expect(input("#sync-password").value).toBe("");
    expect(input("#sync-password").placeholder).toContain("已保存");
    expect(input("#sync-auto").checked).toBe(true);
    expect(container.textContent).toContain("上次同步");
  });

  test("保存连接传递新配置和密码，成功后清空密码输入且不回显", async () => {
    const controller = createController(snapshot());
    render(controller);

    typeConnection({
      url: "https://dav.example.com/progress",
      username: "yandi",
      password: "app-secret",
    });
    await submitForm();

    expect(controller.configure).toHaveBeenCalledWith(
      {
        url: "https://dav.example.com/progress",
        username: "yandi",
        autoSync: true,
      },
      "app-secret"
    );
    expect(input("#sync-password").value).toBe("");
    expect(container.textContent).toContain("连接设置已保存");
    expect(container.textContent).not.toContain("app-secret");
  });

  test("已保存密码且账号未变时留空保存保留原密码，不传空字符串", async () => {
    const controller = createController(snapshot({ config: CONNECTED }));
    render(controller);

    await submitForm();

    expect(controller.configure).toHaveBeenCalledWith(
      {
        url: CONNECTED.url,
        username: CONNECTED.username,
        autoSync: true,
      },
      undefined
    );
  });

  test("修改地址后不能沿用旧密码，必须重新输入", async () => {
    const controller = createController(snapshot({ config: CONNECTED }));
    render(controller);

    typeConnection({ url: "https://dav.example.com/new-dir" });
    expect(input("#sync-password").placeholder).toContain(
      "请输入应用密码"
    );

    await submitForm();

    expect(controller.configure).not.toHaveBeenCalled();
    expect($('[role="alert"]')?.textContent).toContain("请输入应用密码");
  });

  test("自动同步开关随保存一起提交", async () => {
    const controller = createController(snapshot({ config: CONNECTED }));
    render(controller);

    click(input("#sync-auto"));
    await submitForm();

    expect(controller.configure).toHaveBeenCalledWith(
      {
        url: CONNECTED.url,
        username: CONNECTED.username,
        autoSync: false,
      },
      undefined
    );
  });

  test("首次连接缺少密码时给出可读提示且不调用保存", async () => {
    const controller = createController(snapshot());
    render(controller);

    typeConnection({
      url: CONNECTED.url,
      username: CONNECTED.username,
    });
    await submitForm();

    expect(controller.configure).not.toHaveBeenCalled();
    expect($('[role="alert"]')?.textContent).toContain("请输入应用密码");
  });

  test("地址字段说明 WebDAV 根地址和自动创建的固定应用文件夹", () => {
    render(createController(snapshot({ config: CONNECTED })));

    expect(container.textContent).toContain("WebDAV 根地址");
    expect(container.textContent).toContain("FrenchGrammarExercise/");
    expect(container.textContent).toContain("自动创建");
    expect(container.textContent).toContain("固定不可编辑");
    expect(container.textContent).toContain("不需要提前建目录");
    expect(container.textContent).toContain("局域网和自建服务");
    expect(container.querySelector(".sync-folder input")).toBeNull();
    expect(
      container.querySelector('.sync-folder [contenteditable="true"]')
    ).toBeNull();
    expect(container.textContent).not.toContain("MKCOL");
    expect(container.textContent).not.toContain("PROPFIND");
  });

  test("接受 HTTP 根地址保存，不弹确认也不显示安全警告", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const controller = createController(snapshot());
    render(controller);

    typeConnection({
      url: "http://192.168.1.20:8080/dav",
      username: CONNECTED.username,
      password: "app-secret",
    });
    await submitForm();

    expect(controller.configure).toHaveBeenCalledWith(
      {
        url: "http://192.168.1.20:8080/dav",
        username: CONNECTED.username,
        autoSync: true,
      },
      "app-secret"
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("不安全");
    expect(container.textContent).not.toContain("风险");
  });

  test("拒绝 HTTP 与 HTTPS 之外的地址协议", async () => {
    const controller = createController(snapshot());
    render(controller);

    typeConnection({
      url: "ftp://dav.example.com/fge",
      username: CONNECTED.username,
      password: "app-secret",
    });
    await submitForm();

    expect(controller.configure).not.toHaveBeenCalled();
    expect($('[role="alert"]')?.textContent).toContain("http:// 或 https://");
  });

  test.each([
    ["http://user:pass@dav.example.com/dav", "用户名或密码"],
    ["https://dav.example.com/dav?token=1", "查询参数"],
    ["https://dav.example.com/dav#section", "查询参数或片段"],
  ])("继续拒绝地址中的账号信息、查询或片段：%s", async (url, expected) => {
    const controller = createController(snapshot());
    render(controller);

    typeConnection({
      url,
      username: CONNECTED.username,
      password: "app-secret",
    });
    await submitForm();

    expect(controller.configure).not.toHaveBeenCalled();
    expect($('[role="alert"]')?.textContent).toContain(expected);
  });

  test("控制器的保存错误直接显示给用户", async () => {
    const controller = createController(snapshot());
    vi.mocked(controller.configure).mockRejectedValueOnce(
      new Error("该地址不是可用的 WebDAV 目录。")
    );
    render(controller);

    typeConnection({
      url: CONNECTED.url,
      username: CONNECTED.username,
      password: "app-secret",
    });
    await submitForm();

    expect($('[role="alert"]')?.textContent).toContain("该地址不是可用的 WebDAV 目录");
    expect(input("#sync-password").value).toBe("app-secret");
  });

  test("控制器只写错误快照不抛时，不宣布保存成功也不清空密码", async () => {
    const controller = createController(snapshot({ config: CONNECTED }));
    vi.mocked(controller.configure).mockImplementationOnce(async () => {
      controller.setSnapshot(
        snapshot({
          config: CONNECTED,
          status: "error",
          message: "保存同步配置失败，请检查系统存储",
        })
      );
    });
    render(controller);

    typeConnection({
      url: "https://dav.example.com/new-dir",
      username: CONNECTED.username,
      password: "app-secret",
    });
    await submitForm();

    expect(container.textContent).not.toContain("连接设置已保存");
    expect(input("#sync-password").value).toBe("app-secret");
    expect(input("#sync-url").value).toBe("https://dav.example.com/new-dir");
    expect(container.textContent).toContain("保存同步配置失败");
  });

  test("配置已保存但首次同步失败时，分别提示保存结果与同步错误", async () => {
    const controller = createController(snapshot());
    const settings = {
      url: "https://dav.example.com/new-dir",
      username: CONNECTED.username,
      autoSync: true,
    };
    vi.mocked(controller.configure).mockImplementationOnce(async () => {
      controller.setSnapshot(
        snapshot({
          config: { ...settings, hasPassword: true },
          status: "error",
          message: "云端认证失败，请检查用户名与应用密码",
        })
      );
    });
    render(controller);

    typeConnection({
      url: settings.url,
      username: settings.username,
      password: "app-secret",
    });
    await submitForm();

    expect(container.textContent).toContain("连接设置已保存，但首次同步未完成");
    expect(container.textContent).toContain("云端认证失败");
    expect(input("#sync-password").value).toBe("");
  });

  test("断开连接清除本机连接信息并保留学习进度", async () => {
    const controller = createController(snapshot({ config: CONNECTED }));
    render(controller);

    click(buttonByText("断开连接"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(controller.disconnect).toHaveBeenCalledTimes(1);
    expect(input("#sync-url").value).toBe("");
    expect(input("#sync-username").value).toBe("");
    expect(container.textContent).toContain("已断开同步");
    expect(container.textContent).toContain("学习进度和云端文件都保留");
  });

  test("控制器只写错误快照不抛时，保留表单且不宣布断开成功", async () => {
    const controller = createController(snapshot({ config: CONNECTED }));
    vi.mocked(controller.disconnect).mockImplementationOnce(async () => {
      controller.setSnapshot(
        snapshot({
          config: CONNECTED,
          status: "error",
          message: "断开同步失败，请重试",
        })
      );
    });
    render(controller);

    click(buttonByText("断开连接"));
    await flush();

    expect(container.textContent).not.toContain("已断开同步");
    expect(container.textContent).toContain("断开同步失败");
    expect(input("#sync-url").value).toBe(CONNECTED.url);
    expect(input("#sync-username").value).toBe(CONNECTED.username);
    expect(buttonByText("断开连接").disabled).toBe(false);
  });
});

describe("SyncSettings 状态与立即同步", () => {
  test("未连接时立即同步不可用，连接后可用", () => {
    const controller = createController(snapshot());
    render(controller);
    expect(buttonByText("立即同步").disabled).toBe(true);
  });

  test("立即同步调用控制器并在完成后显示时间", async () => {
    const controller = createController(snapshot({ config: CONNECTED }));
    render(controller);

    click(buttonByText("立即同步"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(controller.sync).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("已同步");
    expect(container.textContent).toContain("2026-11-15 10:20");
  });

  test("同步失败显示可读错误并使用 alert 角色", () => {
    render(
      createController(
        snapshot({
          status: "error",
          config: CONNECTED,
          message: "认证失败，请检查用户名和应用密码。",
        })
      )
    );

    const alert = $('[role="alert"]');
    expect(alert?.textContent).toContain("认证失败");
    expect(alert?.textContent).toContain("用户名和应用密码");
  });

  test("同步中禁用立即同步并显示进度状态", () => {
    render(
      createController(snapshot({ status: "syncing", config: CONNECTED }))
    );
    expect(buttonByText("立即同步").disabled).toBe(true);
    expect(buttonByText("保存连接").disabled).toBe(true);
    expect(buttonByText("断开连接").disabled).toBe(true);
    expect(container.textContent).toContain("正在同步");
  });
});

describe("SyncSettings 操作互斥", () => {
  function conflictSnapshot(): SyncSnapshot {
    return snapshot({
      status: "conflict",
      config: CONNECTED,
      conflict: {
        local: LOCAL_BACKUP,
        remote: REMOTE_BACKUP,
        remoteEtag: '"etag-1"',
      },
    });
  }

  test("保存配置进行中禁用重复保存、断开和冲突按钮", async () => {
    const controller = createController(conflictSnapshot());
    let finish: (() => void) | undefined;
    vi.mocked(controller.configure).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    render(controller);

    await submitForm();

    expect(
      (container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(buttonByText("断开连接").disabled).toBe(true);
    expect(buttonByText("用本机覆盖云端").disabled).toBe(true);
    expect(buttonByText("用云端替换本机").disabled).toBe(true);
    expect(buttonByText("暂不处理").disabled).toBe(true);

    await act(async () => {
      finish?.();
      await Promise.resolve();
    });

    expect(
      (container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled
    ).toBe(false);
    expect(buttonByText("断开连接").disabled).toBe(false);
    expect(buttonByText("用本机覆盖云端").disabled).toBe(false);
  });

  test("同步进行中禁用保存、断开和冲突按钮", async () => {
    const controller = createController(conflictSnapshot());
    let finish: (() => void) | undefined;
    vi.mocked(controller.sync).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    render(controller);

    click(buttonByText("立即同步"));
    await flush();

    expect(
      (container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(buttonByText("断开连接").disabled).toBe(true);
    expect(buttonByText("用本机覆盖云端").disabled).toBe(true);
    expect(buttonByText("用云端替换本机").disabled).toBe(true);
    expect(buttonByText("暂不处理").disabled).toBe(true);

    await act(async () => {
      finish?.();
      await Promise.resolve();
    });

    expect(buttonByText("用本机覆盖云端").disabled).toBe(false);
        expect(buttonByText("断开连接").disabled).toBe(false);
  });
});

describe("SyncSettings 恢复副本", () => {
  test("没有副本时不显示导出入口", () => {
    render(createController(snapshot({ config: CONNECTED })));
    expect(container.textContent).not.toContain("最近的同步前副本");
  });

  test("显示最近副本日期、两份摘要，并可分别导出而不改当前进度", async () => {
    seedRecovery();
    render(createController(snapshot({ config: CONNECTED })));

    expect(container.textContent).toContain("最近的同步前副本");
    expect(container.textContent).toContain("2026-11-15 09:40");
    expect(container.textContent).toContain("本机旧记录");
    expect(container.textContent).toContain("云端旧记录");
    expect(container.textContent).toContain("120 XP");
    expect(container.textContent).toContain("480 XP");
    expect(container.textContent).toContain("不会自动替换当前进度");

    click(
      $(
        'button[aria-label="导出 2026-11-15 09:40 的本机旧记录"]'
      ) as HTMLButtonElement
    );
    await flush();
    expect(backupMocks.exportBackup).toHaveBeenLastCalledWith(LOCAL_BACKUP.progress);
    expect(container.textContent).toContain("已导出本机旧记录");

    click(
      $(
        'button[aria-label="导出 2026-11-15 09:40 的云端旧记录"]'
      ) as HTMLButtonElement
    );
    await flush();
    expect(backupMocks.exportBackup).toHaveBeenLastCalledWith(REMOTE_BACKUP.progress);
    expect(container.textContent).toContain("已导出云端旧记录");

    // 导出只生成文件,不覆盖当前学习进度。
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("按最新在前展示多份历史副本，并可导出指定一份", async () => {
    seedRecovery(CONNECTED, false, "2026-11-14T08:00:00", 80, "remote-apply");
    seedRecovery(CONNECTED, true, "2026-11-15T09:40:00", 120, "conflict");
    render(createController(snapshot({ config: CONNECTED })));

    const text = container.textContent ?? "";
    expect(text.indexOf("2026-11-15 09:40")).toBeLessThan(
      text.indexOf("2026-11-14 08:00")
    );
    expect(text).toContain("最多保留 3 份");
    expect(text).toContain("最新");
    expect(text).toContain("120 XP");
    expect(text).toContain("80 XP");
    expect(text).toContain("应用云端前保存");

    click(
      $(
        'button[aria-label="导出 2026-11-14 08:00 的本机旧记录"]'
      ) as HTMLButtonElement
    );
    await flush();
    expect(backupMocks.exportBackup).toHaveBeenLastCalledWith({
      ...LOCAL_BACKUP.progress,
      xp: 80,
    });
    expect(
      $('button[aria-label="导出 2026-11-14 08:00 的云端旧记录"]')
    ).toBeNull();
  });

  test("只有本机副本时只显示一个导出入口", () => {
    seedRecovery(CONNECTED, false);
    render(createController(snapshot({ config: CONNECTED })));

    expect(container.textContent).toContain("本机旧记录");
    expect(container.textContent).not.toContain("云端旧记录");
    expect(buttonByText("导出本机")).toBeDefined();
  });

  test("用户取消系统分享时提示取消而不是错误", async () => {
    seedRecovery();
    backupMocks.exportBackup.mockRejectedValueOnce(new Error("cancelled"));
    backupMocks.isBackupCancelled.mockReturnValueOnce(true);
    render(createController(snapshot({ config: CONNECTED })));

    click(buttonByText("导出本机"));
    await flush();

    expect(container.textContent).toContain("已取消导出");
    expect($('[role="alert"]')).toBeNull();
  });

  test("导出失败显示可读错误", async () => {
    seedRecovery();
    backupMocks.exportBackup.mockRejectedValueOnce(new Error("无法写入文件"));
    render(createController(snapshot({ config: CONNECTED })));

    click(buttonByText("导出本机"));
    await flush();

    expect($('[role="alert"]')?.textContent).toContain("无法写入文件");
  });

  test("切换到另一个账号后不显示旧账号的副本", () => {
    seedRecovery();
    render(
      createController(
        snapshot({
          config: { ...CONNECTED, username: "another-user" },
        })
      )
    );

    expect(container.textContent).not.toContain("最近的同步前副本");
  });

  test("同步完成后重新读取刚写入的恢复副本", async () => {
    const controller = createController(snapshot({ config: CONNECTED }));
    render(controller);
    expect(container.textContent).not.toContain("最近的同步前副本");

    await act(async () => {
      seedRecovery();
      controller.setSnapshot(
        snapshot({
          config: CONNECTED,
          status: "synced",
          lastSyncedAt: "2026-11-15T10:00:00",
        })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("最近的同步前副本");
    expect(container.textContent).toContain("本机旧记录");
  });
});

describe("SyncSettings 冲突", () => {
  function renderConflict() {
    const controller = createController(
      snapshot({
        status: "conflict",
        config: CONNECTED,
        message: "本机与云端都发生了变化。",
        conflict: {
          local: LOCAL_BACKUP,
          remote: REMOTE_BACKUP,
          remoteEtag: '"etag-1"',
        },
      })
    );
    render(controller);
    return controller;
  }

  test("并列展示本机与云端学习摘要，不用 confirm 弹窗", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderConflict();

    expect(container.textContent).toContain("本机");
    expect(container.textContent).toContain("云端");
    expect(container.textContent).toContain("120 XP");
    expect(container.textContent).toContain("480 XP");
    expect(container.textContent).toContain("2 关");
    expect(container.textContent).toContain("4 关");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test("选择本机覆盖云端调用 local 分支", async () => {
    const controller = renderConflict();
    click(buttonByText("用本机覆盖云端"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(controller.resolveConflict).toHaveBeenCalledWith("local");
    expect(container.textContent).toContain("已使用本机进度覆盖云端");
  });

  test("选择云端替换本机调用 remote 分支", async () => {
    const controller = renderConflict();
    click(buttonByText("用云端替换本机"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(controller.resolveConflict).toHaveBeenCalledWith("remote");
    expect(container.textContent).toContain("已使用云端进度替换本机");
  });

  test.each([
    {
      status: "conflict" as const,
      message: "云端与本机都有新的学习进度，请选择保留哪一份",
    },
    {
      status: "idle" as const,
      message: "正在练习或阅读，稍后再应用云端学习进度",
    },
    {
      status: "error" as const,
      message: "云端同步文件无效，已停止自动同步",
    },
  ])(
    "冲突未真正解决（$status）时保留控制器消息，不宣布覆盖成功",
    async ({ status, message }) => {
      const controller = renderConflict();
      vi.mocked(controller.resolveConflict).mockImplementationOnce(async () => {
        controller.setSnapshot(
          snapshot({
            status,
            config: CONNECTED,
            message,
            conflict: {
              local: LOCAL_BACKUP,
              remote: REMOTE_BACKUP,
              remoteEtag: '"etag-1"',
            },
          })
        );
      });

      click(buttonByText("用本机覆盖云端"));
      await flush();

      expect(controller.resolveConflict).toHaveBeenCalledWith("local");
      expect(container.textContent).toContain(message);
      expect(container.textContent).not.toContain("已使用本机进度覆盖云端");
    }
  );

  test("暂不处理保留冲突且可重新打开比较", () => {
    const controller = renderConflict();

    click(buttonByText("暂不处理"));

    expect(controller.resolveConflict).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("用本机覆盖云端");
    expect(container.textContent).toContain("有未处理的同步冲突");

    click(buttonByText("查看冲突"));
    expect(container.textContent).toContain("用本机覆盖云端");
    expect(container.textContent).toContain("120 XP");
  });

  test("冲突选择进行中禁用两个覆盖按钮，避免重复提交", async () => {
    const controller = renderConflict();
    let finish: (() => void) | undefined;
    vi.mocked(controller.resolveConflict).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );

    click(buttonByText("用本机覆盖云端"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(buttonByText("用本机覆盖云端").disabled).toBe(true);
    expect(buttonByText("用云端替换本机").disabled).toBe(true);

    await act(async () => {
      finish?.();
      await Promise.resolve();
    });
  });
});
