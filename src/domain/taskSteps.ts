export const taskStepDefinitions = [
  { key: "validate_input", title: "校验输入" },
  { key: "audit_project", title: "审计 LaTeX 项目" },
  { key: "parse_report", title: "解析报告" },
  { key: "build_revision_pack", title: "生成修订包" },
  { key: "index_segments", title: "索引 LaTeX 段落" },
  { key: "diagnose_style", title: "诊断模板化表达" },
  { key: "match_findings", title: "匹配报告命中" },
  { key: "generate_revisions", title: "生成修订建议" },
  { key: "validate_revisions", title: "校验修订建议" },
  { key: "generate_report", title: "生成 dry-run 报告" },
] as const;

export type TaskStepKey = (typeof taskStepDefinitions)[number]["key"];

export const terminalTaskStates = new Set(["completed", "failed", "cancelled"]);
