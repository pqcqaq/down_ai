# Skill 集成计划

## 集成目标

`../BypassAIGC-Skill` 提供的是 Agent 规则、提示词知识和 Python 脚本。应用层需要把这些能力封装为稳定的服务工具，而不是直接让模型自由读写文件。

## 能力映射

| Skill 能力 | 应用内工具 | 用途 |
| --- | --- | --- |
| `latex_project_audit.py` | `auditLatexProject` | 找主文件、引用关系、重复 label、未解析 ref |
| `build_revision_pack.py` | `buildRevisionPack` | 生成可修订 segment 包 |
| `chinese_ai_style_lint.py` | `lintChineseStyle` | 标记中文论文模板化和机械表达 |
| `render_revision_prompt.py` | `renderRevisionPrompt` | 为单段生成受约束提示词 |
| `lint_revision_packet.py` | `lintRevisionPacket` | 应用前检查 token 漂移和危险表达 |
| `apply_segment_revisions.py` | `applySegmentRevisions` | 把修订结果写回 `.tex` |
| `latex_segmenter.py check` | `checkLatexProtectedTokens` | 应用后比较 protected token |

## 运行方式

推荐封装一个 `SkillRuntime`：

```ts
type SkillRuntimeConfig = {
  skillDir: string;
  pythonBin: string;
  workingDir: string;
  timeoutMs: number;
};
```

执行脚本时需要：

- 固定 `cwd` 为目标 LaTeX 项目或任务工作目录。
- 禁止脚本写出到用户未授权目录。
- 所有输入路径先做规范化和白名单检查。
- 收集 stdout、stderr、exitCode、durationMs。
- 将每次工具调用写入任务日志。

## 路径策略

环境变量：

```text
BYPASS_AIGC_SKILL_DIR=../BypassAIGC-Skill
PYTHON_BIN=python
WORKSPACE_ROOT=D:/Develop/Projects
```

服务启动时检查：

- Skill 目录存在。
- `SKILL.md` 存在。
- `scripts/` 下核心脚本存在。
- Python 可执行。
- 对示例文件执行一次只读 smoke test。

## 修订包约束

应用内不让模型直接修改 `.tex` 文件，而是让模型填写 revision packet：

```ts
type RevisionDecision = {
  segmentId: string;
  action: "keep" | "revise" | "needs_review";
  revisedText?: string;
  revisionNote: string;
  riskFlags: string[];
  confidence: number;
};
```

只有满足以下条件才自动应用：

- `action=revise`。
- `confidence` 达到阈值。
- `lintRevisionPacket` 通过。
- 未新增 citation key、label、公式或实验数据。
- 未触发人工复核规则。

## 提示词接入

提示词来源按优先级：

1. Skill 的 `render_revision_prompt.py` 输出。
2. 应用内系统提示词补充任务边界。
3. 用户配置中的风格偏好。

系统提示词必须包含：

- 不承诺检测器结果。
- 保留引用、公式、标签、环境。
- 不新增事实、数据、文献、结论。
- 只返回结构化 JSON。

## 版本管理

后续建议把 `../BypassAIGC-Skill` 固定为：

- Git submodule。
- npm/postinstall 拉取脚本。
- 或发布为独立工具包。

第一版先通过环境变量引用本地目录，降低集成成本。
