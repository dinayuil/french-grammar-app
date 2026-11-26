import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchReleaseCode,
  getReleasePlatform,
  openClientRelease,
  releaseVersionName,
} from "./clientRelease";

type UpdateState =
  | { status: "checking" | "current" | "error"; latestVersion: null }
  | { status: "available"; latestVersion: string };

export type ClientUpdates = UpdateState & {
  installedVersion: string;
  check: () => void;
  openRelease: () => Promise<void>;
};

const CHECK_TIMEOUT_MS = 10_000;

export function useClientUpdates(): ClientUpdates | null {
  const installedCode = __FGE_PUBLIC_RELEASE_CODE__;
  const [platform] = useState(() => installedCode === null ? null : getReleasePlatform());
  const [state, setState] = useState<UpdateState>({
    status: "checking",
    latestVersion: null,
  });
  const pending = useRef<AbortController | null>(null);

  const check = useCallback(() => {
    if (!platform || installedCode === null || pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setState({ status: "checking", latestVersion: null });

    const timeout = setTimeout(() => request.abort(), CHECK_TIMEOUT_MS);
    void fetchReleaseCode(platform, request.signal)
      .then((code) => {
        if (pending.current !== request) return;
        setState(
          code > installedCode
            ? { status: "available", latestVersion: releaseVersionName(code) }
            : { status: "current", latestVersion: null },
        );
      })
      .catch(() => {
        if (pending.current === request) setState({ status: "error", latestVersion: null });
      })
      .finally(() => {
        clearTimeout(timeout);
        if (pending.current === request) pending.current = null;
      });
  }, [installedCode, platform]);

  useEffect(() => {
    if (!platform) return;
    // StrictMode remounts effects before this task runs.
    const start = setTimeout(check, 0);
    return () => {
      clearTimeout(start);
      pending.current?.abort();
      pending.current = null;
    };
  }, [check, platform]);

  if (!platform || installedCode === null) return null;
  return {
    ...state,
    installedVersion: releaseVersionName(installedCode),
    check,
    openRelease: () => openClientRelease(platform),
  };
}
