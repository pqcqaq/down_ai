import path from "node:path";
import { env } from "../config/env.js";

export function resolveFromRoot(inputPath: string): string {
  return path.resolve(inputPath);
}

export function assertInsideWorkspace(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  const workspaceRoot = path.resolve(env.workspaceRoot);
  const relative = path.relative(workspaceRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside WORKSPACE_ROOT: ${resolved}`);
  }

  return resolved;
}

export function toPosixPath(inputPath: string): string {
  return inputPath.split(path.sep).join("/");
}
