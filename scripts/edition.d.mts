export type Edition = "public" | "internal";

export function resolveEdition(raw: string | undefined): Edition;
