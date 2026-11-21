import path from "node:path";

export const PREPARE_ROOT = (): string => path.join(process.cwd(), "预处理");

/** 路径必须落在 root 里面（含 root 自己）。返回解析后的绝对路径。 */
export function assertInside(root: string, target: string): string {
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径不在允许范围内: ${target}`);
  }
  return resolved;
}
