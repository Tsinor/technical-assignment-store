export type Permission = "r" | "w" | "rw" | "none";

export function intersectPermissions(
  parent: Permission,
  child: Permission
): Permission {
  if (parent === "none" || child === "none") return "none";
  if (parent === "rw") return child;
  if (child === "rw") return parent;
  if (parent === child) return parent;
  return "none";
}

export function canRead(permission: Permission): boolean {
  return permission === "r" || permission === "rw";
}

export function canWrite(permission: Permission): boolean {
  return permission === "w" || permission === "rw";
}
