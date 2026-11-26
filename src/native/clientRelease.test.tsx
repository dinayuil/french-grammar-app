import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { fetchReleaseCode } from "./clientRelease";
import { useClientUpdates, type ClientUpdates } from "./useClientUpdates";

const RELEASE_API =
  "https://api.github.com/repos/dinayuil/french-grammar-app/releases/tags/client-latest";

function release(code: number) {
  return {
    tag_name: "client-latest",
    draft: false,
    prerelease: true,
    body: `## 客户端公开测试版\r\n- versionCode: \`${code}\`\r\n- versionName: \`1.0-test.${code}\`\r\n`,
    assets: [
      { name: "app-public-debug.apk", state: "uploaded" },
      { name: "fge-windows-public-standard-setup.exe", state: "uploaded" },
      { name: "fge-windows-public-offline-setup.exe", state: "uploaded" },
    ],
  };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchReleaseCode", () => {
  const signal = new AbortController().signal;

  it("reads the rolling prerelease through the public tag endpoint", async () => {
    fetchMock.mockResolvedValue(Response.json(release(62)));
    await expect(fetchReleaseCode("windows", signal)).resolves.toBe(62);
    expect(fetchMock).toHaveBeenCalledWith(RELEASE_API, expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      signal,
    }));
  });

  it("rejects unfinished uploads and mismatched version markers", async () => {
    const missingInstaller = release(62);
    missingInstaller.assets[2].state = "starter";
    fetchMock.mockResolvedValueOnce(Response.json(missingInstaller));
    await expect(fetchReleaseCode("windows", signal)).rejects.toThrow("assets");

    const mismatch = { ...release(62), body: release(62).body.replace("test.62", "test.61") };
    fetchMock.mockResolvedValueOnce(Response.json(mismatch));
    await expect(fetchReleaseCode("android", signal)).rejects.toThrow("version");
  });
});

describe("useClientUpdates", () => {
  let root: Root;
  let updates: ClientUpdates | null;

  function Probe() {
    updates = useClientUpdates();
    return null;
  }

  async function mount() {
    await act(async () => root.render(<StrictMode><Probe /></StrictMode>));
    await act(async () => { await vi.runAllTimersAsync(); });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("__FGE_PUBLIC_RELEASE_CODE__", 61);
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    vi.useFakeTimers();
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("checks once at startup, then accepts manual checks for newer releases only", async () => {
    vi.stubGlobal("__FGE_EDITION__", "public");
    fetchMock
      .mockResolvedValueOnce(Response.json(release(62)))
      .mockResolvedValueOnce(Response.json(release(60)));
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates).toMatchObject({
      installedVersion: "1.0-test.61",
      status: "available",
      latestVersion: "1.0-test.62",
    });
    await act(async () => updates?.check());
    expect(updates).toMatchObject({ status: "current", latestVersion: null });
  });

  it("reports HTTP errors and retries successfully", async () => {
    vi.stubGlobal("__FGE_EDITION__", "public");
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.json(release(61)));
    await mount();
    expect(updates?.status).toBe("error");
    await act(async () => updates?.check());
    expect(updates?.status).toBe("current");
  });

  it("times out a stalled request so the user can retry", async () => {
    vi.stubGlobal("__FGE_EDITION__", "public");
    fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
    }));
    await mount();
    expect(updates?.status).toBe("error");
  });

  it("uses the Windows command to open the release page", async () => {
    vi.stubGlobal("__FGE_EDITION__", "public");
    vi.stubGlobal("isTauri", true);
    const invokeMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: invokeMock });
    vi.mocked(Capacitor.getPlatform).mockReturnValue("web");
    fetchMock.mockResolvedValueOnce(Response.json(release(62)));
    await mount();

    expect(updates?.status).toBe("available");
    await updates?.openRelease();
    expect(invokeMock).toHaveBeenCalledWith("open_client_release", {}, undefined);
  });

  it.each([
    { edition: "internal", platform: "android", code: 61 },
    { edition: "public", platform: "web", code: 61 },
    { edition: "public", platform: "android", code: null },
  ])("skips release checks for $edition $platform with version $code", async ({ edition, platform, code }) => {
    vi.stubGlobal("__FGE_EDITION__", edition);
    vi.stubGlobal("__FGE_PUBLIC_RELEASE_CODE__", code);
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    await mount();
    expect(updates).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
