import fs from "node:fs/promises";
import path from "node:path";
import { assertInsideWorkspace } from "../utils/pathSafety.js";

export type WorkspaceInspection = {
  projectDir: string;
  exists: boolean;
  texFiles: number;
  bibFiles: number;
  rootCandidates: string[];
  warnings: string[];
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
}
