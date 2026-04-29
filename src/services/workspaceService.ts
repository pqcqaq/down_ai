import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { assertInsideWorkspace } from "../utils/pathSafety.js";

export type WorkspaceInspection = {
  projectDir: string;
  exists: boolean;
  texFiles: number;
  bibFiles: number;
  rootCandidates: string[];
  warnings: string[];
};

export type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
  texFiles: number;
  bibFiles: number;
  rootCandidates: number;
  isLatexProject: boolean;
};

export type WorkspaceBrowseResult = {
  workspaceRoot: string;
  currentDir: string;
  parentDir?: string;
  entries: WorkspaceDirectoryEntry[];
};

export class WorkspaceService {
  async inspect(projectDir: string): Promise<WorkspaceInspection> {
    const resolved = assertInsideWorkspace(projectDir);
    const warnings: string[] = [];
    const stat = await fs.stat(resolved).catch(() => undefined);

    if (!stat?.isDirectory()) {
      return {
        projectDir: resolved,
        exists: false,
        texFiles: 0,
        bibFiles: 0,
        rootCandidates: [],
        warnings: ["目录不存在或不是目录。"],
      };
    }

    const files = await this.walk(resolved);
    const texFiles = files.filter((file) => file.endsWith(".tex"));
    const bibFiles = files.filter((file) => file.endsWith(".bib"));
    const rootCandidates: string[] = [];

    for (const file of texFiles) {
      const content = await fs.readFile(file, "utf8").catch(() => "");
      if (/\\documentclass(?:\[[^\]]*])?\{/.test(content) && /\\begin\{document\}/.test(content)) {
        rootCandidates.push(file);
      }
    }

    if (texFiles.length === 0) {
      warnings.push("未找到 .tex 文件。");
    }
    if (rootCandidates.length === 0 && texFiles.length > 0) {
      warnings.push("未找到明确主文件，将使用第一个 .tex 文件作为候选。");
    }

    return {
      projectDir: resolved,
      exists: true,
      texFiles: texFiles.length,
      bibFiles: bibFiles.length,
      rootCandidates,
      warnings,
    };
  }

  async browse(inputDir?: string): Promise<WorkspaceBrowseResult> {
    const workspaceRoot = path.resolve(env.workspaceRoot);
    const currentDir = assertInsideWorkspace(inputDir?.trim() || workspaceRoot);
    const stat = await fs.stat(currentDir).catch(() => undefined);
    if (!stat?.isDirectory()) {
      throw new Error(`Workspace browse target is not a directory: ${currentDir}`);
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
      .slice(0, 200);

    const result: WorkspaceDirectoryEntry[] = [];
    for (const entry of directories) {
      const fullPath = path.join(currentDir, entry.name);
      result.push(await this.summarizeDirectory(entry.name, fullPath));
    }

    return {
      workspaceRoot,
      currentDir,
      parentDir: path.resolve(currentDir) === workspaceRoot ? undefined : path.dirname(currentDir),
      entries: result,
    };
  }

  private async walk(root: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await fs.readdir(root, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        result.push(...(await this.walk(fullPath)));
      } else {
        result.push(fullPath);
      }
    }

    return result;
  }

  private async summarizeDirectory(name: string, fullPath: string): Promise<WorkspaceDirectoryEntry> {
    const entries = await fs.readdir(fullPath, { withFileTypes: true }).catch(() => []);
    const texFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".tex")).length;
    const bibFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".bib")).length;
    let rootCandidates = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".tex")) {
        continue;
      }
      const content = await fs.readFile(path.join(fullPath, entry.name), "utf8").catch(() => "");
      if (/\\documentclass(?:\[[^\]]*])?\{/.test(content) && /\\begin\{document\}/.test(content)) {
        rootCandidates += 1;
      }
    }

    return {
      name,
      path: fullPath,
      texFiles,
      bibFiles,
      rootCandidates,
      isLatexProject: texFiles > 0 || rootCandidates > 0,
    };
  }
}
