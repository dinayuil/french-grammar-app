import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_PROGRESS } from "../storage";
import { LocaleProvider, useLocale } from "../i18n/LocaleProvider";
import type { Progress } from "../types";
import type { ProgressBackup } from "../backup/progressBackup";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const backupMocks = vi.hoisted(() => ({
  exportBackup: vi.fn(),
  isBackupCancelled: vi.fn(),
  parseBackup: vi.fn(),
  restoreBackup: vi.fn(),
  loadRecoveryBackup: vi.fn(),
}));

vi.mock("../backup/progressBackup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../backup/progressBackup")>()),
  ...backupMocks,
}));

import { ProgressBackup as ProgressBackupPanel } from "./ProgressBackup";
import { SettingsView } from "./SettingsView";

let container: HTMLDivElement;
let root: Root;

const CURRENT: Progress = {
  ...DEFAULT_PROGRESS,
  xp: 30,
  dailyGoal: 30,
  lessons: { "c01-l01": { completed: true, stars: 3 } },
};

const BACKUP: ProgressBackup = {
  format: "fge-progress",
  version: 1,
  edition: "public",
  exportedAt: "2026-11-10T12:00:00.000Z",
  progress: {
    ...DEFAULT_PROGRESS,
    xp: 420,
    dailyGoal: 60,
    sound: false,
    translationEnabled: false,
    translationTiming: "before",
    lessons: {
      "c01-l01": { completed: true, stars: 3 },
      "c01-l02": { completed: true, stars: 1 },
      "c01-l03": { completed: false, stars: 0 },
    },
  },
};

const RECOVERY: ProgressBackup = {
  ...BACKUP,
  exportedAt: "2026-11-09T18:00:00.000Z",
  progress: { ...BACKUP.progress, xp: 88 },
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  backupMocks.isBackupCancelled.mockReturnValue(false);
  backupMocks.loadRecoveryBackup.mockReturnValue(null);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const $ = (selector: string) => container.querySelector(selector) as HTMLElement | null;

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text)
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function LocaleButtons() {
  const { setLocale } = useLocale();
  return (
    <div>
      <button type="button" data-testid="locale-fr" onClick={() => setLocale("fr")}>
        fr
      </button>
      <button
        type="button"
        data-testid="locale-zh"
        onClick={() => setLocale("zh-CN")}
      >
        zh
      </button>
    </div>
  );
}

function tree(panel: ReactNode, controls = false) {
  return (
    <LocaleProvider supportedLocales={["zh-CN", "fr"]}>
      {panel}
      {controls ? <LocaleButtons /> : null}
    </LocaleProvider>
  );
}

function renderPanel(
  onChange: (progress: Progress) => void = vi.fn(),
  options: { locale?: "zh-CN" | "fr"; controls?: boolean } = {}
) {
  if (options.locale) localStorage.setItem("fge:ui-locale:v1", options.locale);
  act(() =>
    root.render(
      tree(<ProgressBackupPanel progress={CURRENT} onChange={onChange} />, options.controls)
    )
  );
  return { onChange };
}

interface FakeFile {
  size: number;
  text: () => Promise<string>;
}

function chooseFile(file: FakeFile): HTMLInputElement {
  const input = $('input[type="file"]') as HTMLInputElement | null;
  if (!input) throw new Error("file input not found");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return input;
}

function readPreview(): HTMLElement {
  const preview = $(".backup-preview");
  if (!preview) throw new Error("backup preview not shown");
  return preview;
}

function alertText(): string {
  return $('[role="alert"]')?.textContent ?? "";
}

describe("学习进度备份", () => {
  test("导出成功：按钮进入忙碌态，完成后提示备份文件已生成", async () => {
    let resolveExport!: () => void;
    backupMocks.exportBackup.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveExport = resolve;
      })
    );
    renderPanel();

    const button = $(".backup-export") as HTMLButtonElement;
    click(button);

    expect(backupMocks.exportBackup).toHaveBeenCalledWith(CURRENT, "zh-CN");
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(($('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
    expect($('[role="status"]')?.textContent).toContain("正在导出");

    await act(async () => {
      resolveExport();
      await Promise.resolve();
    });

    expect(button.disabled).toBe(false);
    expect(($('input[type="file"]') as HTMLInputElement).disabled).toBe(false);
    expect($('[role="status"]')?.textContent).toContain("备份文件已生成");
    expect($('[role="alert"]')).toBeNull();
  });

  test("导出失败只显示错误，不声称成功", async () => {
    backupMocks.exportBackup.mockRejectedValue(new Error("quota"));
    renderPanel();

    click($(".backup-export") as HTMLButtonElement);
    await flushAsync();

    expect(alertText()).toContain("导出失败");
    expect($('[role="status"]')?.textContent ?? "").not.toContain("已生成");
  });

  test("取消系统导出只提示已取消，不冒充失败", async () => {
    backupMocks.exportBackup.mockRejectedValue(new Error("已取消导出"));
    backupMocks.isBackupCancelled.mockReturnValue(true);
    renderPanel();

    click($(".backup-export") as HTMLButtonElement);
    await flushAsync();

    expect($('[role="status"]')?.textContent).toContain("已取消导出");
    expect($('[role="alert"]')).toBeNull();
  });

  test("读取备份只显示日期、XP、已完成关卡与替换警告，不落盘；取消不恢复", async () => {
    backupMocks.parseBackup.mockReturnValue(BACKUP);
    const { onChange } = renderPanel();

    const input = chooseFile({ size: 2048, text: async () => '{"backup":true}' });
    await flushAsync();

    expect(backupMocks.parseBackup).toHaveBeenCalledWith('{"backup":true}');
    expect(backupMocks.restoreBackup).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");

    const preview = readPreview();
    expect(preview.textContent).toContain("2026-11-10");
    expect(preview.textContent).toContain("420 XP");
    expect(preview.textContent).toContain("2 个");
    expect(preview.textContent).toContain("替换当前学习记录");
    expect(preview.textContent).toContain("每日目标、音效、翻译和分享卡设置");
    expect(preview.textContent).toContain("主题设置不会迁移");
    expect($('[role="status"]')?.textContent).toContain("请确认是否恢复");

    click(buttonByText("取消"));
    expect($(".backup-preview")).toBeNull();
    expect(backupMocks.restoreBackup).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("确认恢复先持久化再通知界面，成功后清除预览", async () => {
    backupMocks.parseBackup.mockReturnValue(BACKUP);
    const onChange = vi.fn();
    renderPanel(onChange);
    chooseFile({ size: 2048, text: async () => "{}" });
    await flushAsync();

    click(buttonByText("确认恢复"));

    expect(backupMocks.restoreBackup).toHaveBeenCalledWith(BACKUP, CURRENT);
    expect(onChange).toHaveBeenCalledWith(BACKUP.progress);
    expect(backupMocks.restoreBackup.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0]
    );
    expect($(".backup-preview")).toBeNull();
    expect($('[role="status"]')?.textContent).toContain("已恢复学习进度");
    expect($('[role="alert"]')).toBeNull();
  });

  test("恢复写入失败不回调界面，保留预览并显示错误", async () => {
    backupMocks.parseBackup.mockReturnValue(BACKUP);
    backupMocks.restoreBackup.mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const { onChange } = renderPanel();
    chooseFile({ size: 2048, text: async () => "{}" });
    await flushAsync();

    click(buttonByText("确认恢复"));

    expect(onChange).not.toHaveBeenCalled();
    expect(alertText()).toContain("恢复失败");
    expect(readPreview()).toBeTruthy();
    expect($('[role="status"]')?.textContent ?? "").not.toContain("已恢复学习进度");
  });

  test("恢复已持久化但界面额外保存失败时，提示恢复成功并说明后续保存异常", async () => {
    backupMocks.parseBackup.mockReturnValue(BACKUP);
    const onChange = vi.fn(() => {
      throw new Error("quota exceeded");
    });
    renderPanel(onChange);
    chooseFile({ size: 2048, text: async () => "{}" });
    await flushAsync();

    click(buttonByText("确认恢复"));

    expect(backupMocks.restoreBackup).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect($(".backup-preview")).toBeNull();
    expect(alertText()).toBe("");
    expect($('[role="status"]')?.textContent).toContain("已恢复学习进度");
    expect($('[role="status"]')?.textContent).toContain("后续自动保存失败");
  });

  test("读取文件失败显示错误，不解析也不恢复", async () => {
    renderPanel();
    chooseFile({ size: 100, text: () => Promise.reject(new Error("no file")) });
    await flushAsync();

    expect(backupMocks.parseBackup).not.toHaveBeenCalled();
    expect(alertText()).toContain("读取备份文件失败");
    expect($(".backup-preview")).toBeNull();
  });

  test("无法识别的备份显示解析错误，不恢复", async () => {
    backupMocks.parseBackup.mockImplementation(() => {
      throw new Error("备份版本不受支持");
    });
    const { onChange } = renderPanel();
    chooseFile({ size: 100, text: async () => "{}" });
    await flushAsync();

    expect(alertText()).toContain("备份文件无法识别");
    expect(alertText()).toContain("备份版本不受支持");
    expect(backupMocks.restoreBackup).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect($(".backup-preview")).toBeNull();
  });

  test("超过 5 MB 不读取文件；恰好 5 MB 仍可读取", async () => {
    renderPanel();
    const tooBigText = vi.fn(async () => "{}");
    chooseFile({ size: 5 * 1024 * 1024 + 1, text: tooBigText });
    await flushAsync();

    expect(tooBigText).not.toHaveBeenCalled();
    expect(backupMocks.parseBackup).not.toHaveBeenCalled();
    expect(alertText()).toContain("超过 5 MB");

    backupMocks.parseBackup.mockReturnValue(BACKUP);
    chooseFile({ size: 5 * 1024 * 1024, text: async () => "{}" });
    await flushAsync();

    expect(backupMocks.parseBackup).toHaveBeenCalledTimes(1);
    expect($(".backup-preview")).not.toBeNull();
  });

  test("重复选择同一个文件仍会再次读取", async () => {
    backupMocks.parseBackup.mockReturnValue(BACKUP);
    renderPanel();
    const file: FakeFile = { size: 100, text: vi.fn(async () => "{}") };

    const input = chooseFile(file);
    await flushAsync();
    expect(file.text).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");

    chooseFile(file);
    await flushAsync();
    expect(file.text).toHaveBeenCalledTimes(2);
    expect(backupMocks.parseBackup).toHaveBeenCalledTimes(2);
  });

  test("读取未完成时卸载，不再解析备份", async () => {
    let resolveText!: (text: string) => void;
    const text = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    renderPanel();
    chooseFile({ size: 100, text: () => text });

    act(() => root.render(null));
    await act(async () => {
      resolveText("{}");
      await Promise.resolve();
    });

    expect(backupMocks.parseBackup).not.toHaveBeenCalled();
  });

  test("提供上次导入前记录的预览确认，并走相同的恢复接口", () => {
    backupMocks.loadRecoveryBackup.mockReturnValue(RECOVERY);
    const onChange = vi.fn();
    renderPanel(onChange);

    const recoveryButton = $(".backup-recovery-btn") as HTMLButtonElement | null;
    expect(recoveryButton).not.toBeNull();
    expect(recoveryButton?.textContent).toContain("恢复上次导入前的记录");

    click(recoveryButton!);
    expect(backupMocks.loadRecoveryBackup).toHaveBeenCalledTimes(2);
    expect(readPreview().textContent).toContain("上次导入前的学习记录");
    expect(readPreview().textContent).toContain("88 XP");
    expect(backupMocks.restoreBackup).not.toHaveBeenCalled();

    click(buttonByText("确认恢复"));
    expect(backupMocks.restoreBackup).toHaveBeenCalledWith(RECOVERY, CURRENT);
    expect(onChange).toHaveBeenCalledWith(RECOVERY.progress);
  });

  test("法语界面显示法语标题、按钮、预览摘要和错误详情", async () => {
    backupMocks.parseBackup.mockReturnValue(BACKUP);
    renderPanel(vi.fn(), { locale: "fr" });

    expect(container.textContent).toContain("Sauvegarde de la progression");
    expect(container.textContent).toContain("Exporter la sauvegarde");
    expect(container.textContent).toContain("Importer une sauvegarde");

    chooseFile({ size: 2048, text: async () => "{}" });
    await flushAsync();

    const preview = readPreview();
    expect(preview.textContent).toContain("Date d'exportation");
    expect(preview.textContent).toContain("420 XP");
    expect(preview.textContent).toContain("2 leçons");
    expect(preview.textContent).toContain("objectif quotidien");
    expect(preview.textContent).toContain("thème");
    expect($('[role="status"]')?.textContent).toContain("Sauvegarde lue");
  });

  test("旧错误字符串以当前语言通用主提示显示，原文只出现在技术详情", async () => {
    backupMocks.exportBackup.mockRejectedValue("云存储写入失败");
    renderPanel(vi.fn(), { locale: "fr" });

    click($(".backup-export") as HTMLButtonElement);
    await flushAsync();

    const alert = alertText();
    expect(alert).toContain("Échec de l'exportation");
    expect(alert).toContain("Détails techniques");
    expect(alert).toContain("云存储写入失败");
    expect(alert).not.toMatch(/操作失败/);
  });

  test("异步操作失败后切换语言，错误提示随当前语言更新", async () => {
    backupMocks.exportBackup.mockRejectedValue(new Error("quota"));
    renderPanel(vi.fn(), { controls: true });

    click($(".backup-export") as HTMLButtonElement);
    await flushAsync();
    expect(alertText()).toContain("导出失败");

    click($('[data-testid="locale-fr"]') as HTMLButtonElement);
    expect(alertText()).toContain("Échec de l'exportation");
    expect(alertText()).not.toContain("导出失败");

    click($('[data-testid="locale-zh"]') as HTMLButtonElement);
    expect(alertText()).toContain("导出失败");
  });

  test("导出时把当前界面语言传给备份服务", async () => {
    backupMocks.exportBackup.mockResolvedValue(undefined);
    renderPanel(vi.fn(), { locale: "fr" });

    click($(".backup-export") as HTMLButtonElement);
    await flushAsync();

    expect(backupMocks.exportBackup).toHaveBeenCalledWith(CURRENT, "fr");
  });

  test("导入备份不改变当前界面语言", async () => {
    backupMocks.parseBackup.mockReturnValue(BACKUP);
    renderPanel(vi.fn(), { locale: "fr" });
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    chooseFile({ size: 2048, text: async () => "{}" });
    await flushAsync();
    click(buttonByText("Confirmer la restauration"));

    expect(alertText()).toBe("");
    expect(container.textContent).toContain("Progression restaurée");
    expect(document.documentElement.lang).toBe("fr");
    expect(
      setItem.mock.calls.some(([key]) => key === "fge:ui-locale:v1")
    ).toBe(false);
    setItem.mockRestore();
  });

  test("设置页把学习进度备份放在危险操作之前", () => {
    act(() =>
      root.render(
        tree(<SettingsView progress={CURRENT} onChange={() => {}} />)
      )
    );

    const text = container.textContent ?? "";
    const backupIndex = text.indexOf("学习进度备份");
    const dangerIndex = text.indexOf("危险操作");
    expect(backupIndex).toBeGreaterThanOrEqual(0);
    expect(backupIndex).toBeLessThan(dangerIndex);
  });
});
