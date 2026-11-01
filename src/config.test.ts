import { GOAL_PRESETS, DEFAULT_GOAL, XP_PER_LEVEL, STORAGE_KEY, LEGACY_STORAGE_KEY } from "./config";

test("goal presets and defaults", () => {
  expect(GOAL_PRESETS).toEqual([30, 60, 120]);
  expect(DEFAULT_GOAL).toBe(30);
  expect(XP_PER_LEVEL).toBe(100);
});

test("storage keys follow the compiled edition", () => {
  if (__FGE_EDITION__ === "public") {
    expect(STORAGE_KEY).toBe("fge.public.progress.v2");
    expect(LEGACY_STORAGE_KEY).toBeNull();
  } else {
    expect(STORAGE_KEY).toBe("fge.progress.v2");
    expect(LEGACY_STORAGE_KEY).toBe("fge.progress.v1");
  }
});
