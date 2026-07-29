import type { OrgRole } from "./types";

const ORDER: OrgRole[] = ["viewer", "member", "admin", "owner"];

export function roleAtLeast(actual: OrgRole, required: OrgRole): boolean {
  return ORDER.indexOf(actual) >= ORDER.indexOf(required);
}
