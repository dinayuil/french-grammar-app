import type { CapacitorConfig } from '@capacitor/cli';

export type PackagingEdition = 'public' | 'internal';

export interface EditionIdentity {
  appId: string;
  appName: string;
  webDir: string;
}

// Keep this table in lockstep with the shared edition resolver and
// scripts/build-apk.mjs. The packaging wrapper validates the synchronized
// Capacitor config and fails before Gradle if they disagree.
export const EDITION_IDENTITIES: Record<PackagingEdition, EditionIdentity> = {
  public: {
    appId: 'com.fge.open',
    appName: '法语语法练习·公开版',
    webDir: 'dist/public',
  },
  internal: {
    appId: 'com.fge.app',
    appName: '法语语法练习',
    webDir: 'dist/internal',
  },
};

export function resolveEditionIdentity(raw: string | undefined): EditionIdentity {
  if (raw === undefined) {
    return EDITION_IDENTITIES.public;
  }
  if (raw === 'public' || raw === 'internal') {
    return EDITION_IDENTITIES[raw];
  }
  throw new Error(
    `Unknown edition ${JSON.stringify(raw)}. Expected "public" or "internal".`,
  );
}

const identity = resolveEditionIdentity(process.env.FGE_EDITION);

// Deliberately no `server` block: server hostname, scheme and loading behavior
// stay at the Capacitor defaults used by the old internal APK.
const config: CapacitorConfig = {
  appId: identity.appId,
  appName: identity.appName,
  webDir: identity.webDir,
};

export default config;
