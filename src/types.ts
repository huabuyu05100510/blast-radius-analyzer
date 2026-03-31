/**
 * Blast Radius Analyzer - Type Definitions
 * 分析代码改动影响范围的核心类型
 */

// ─── 改动信息 ────────────────────────────────────────────────────────────────

export interface CodeChange {
  file: string;
  type: ChangeType;
  symbol?: string;         // 改动的符号名 (function/class/interface)
  line?: number;
  diff?: string;           // 具体的 diff 内容
}

export type ChangeType =
  | 'add'           // 新增文件/代码
  | 'delete'        // 删除
  | 'modify'        // 修改
  | 'rename';        // 重命名

// ─── 依赖图 ──────────────────────────────────────────────────────────────────

export interface DependencyNode {
  id: string;              // 文件路径或符号ID
  kind: NodeKind;
  file?: string;
  line?: number;
  exports?: string[];      // 导出的符号
  imports?: ImportInfo[];
  dependents: string[];    // 依赖此节点的节点 (反向索引)
  depth: number;           // 到改动点的距离
}

export type NodeKind =
  | 'file'
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'export';

export interface ImportInfo {
  source: string;
  imported: string[];
  isReExport: boolean;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Edge[];
  entryPoints: string[];   // 入口文件 (main/app entry)
}

export interface Edge {
  from: string;
  to: string;
  type: EdgeType;
  symbol?: string;         // 如果是符号级别的依赖
}

export type EdgeType =
  | 'import'               // import { x } from 'y'
  | 'extend'               // class A extends B
  | 'implement'            // class A implements B
  | 'type-ref'             // type X = Y
  | 'call'                 // A() 调用
  | 'property-access'      // A.b 属性访问
  | 'param-type';          // 参数类型引用

// ─── 影响范围评估 ────────────────────────────────────────────────────────────

export interface ImpactScope {
  changedFile: string;
  timestamp: string;

  // 影响统计
  stats: ImpactStats;

  // 受影响的层级
  levels: ImpactLevel[];

  // 详细的受影响文件
  affectedFiles: AffectedFile[];

  // 传播路径 (从改动到每个受影响点的路径)
  propagationPaths: PropagationPath[];

  // 高风险影响
  highRiskImpacts: HighRiskImpact[];

  // 建议
  recommendations: string[];
}

export interface ImpactStats {
  totalAffectedFiles: number;
  directDependencies: number;      // 直接依赖
  transitiveDependencies: number;  // 传递依赖
  filesWithBreakingChanges: number;
  criticalFiles: number;           // 关键文件 (入口/配置)
  estimatedRippleDepth: number;    // 预计涟漪深度
}

export interface ImpactLevel {
  depth: number;                   // 距离改动的深度
  description: string;
  files: string[];
  nodeCount: number;
}

export interface AffectedFile {
  file: string;
  kind: NodeKind;
  changeType: ChangeType;
  impactLevel: number;             // 1 = 直接依赖, 2 = 传递依赖, etc.
  impactFactors: ImpactFactor[];
  line?: number;                   // 最可能受影响的行
}

export interface ImpactFactor {
  factor: string;
  weight: number;                  // 0-1, 影响权重
  reason: string;
}

export interface PropagationPath {
  from: string;
  to: string;
  path: string[];                  // 完整的传播路径
  edgeTypes: EdgeType[];
  riskLevel: RiskLevel;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface HighRiskImpact {
  file: string;
  reason: string;
  riskLevel: RiskLevel;
  mitigation?: string;
}

// ─── 配置 ────────────────────────────────────────────────────────────────────

export interface AnalyzerConfig {
  projectRoot: string;
  tsConfigPath?: string;

  // 分析范围
  maxDepth: number;                // 最大分析深度
  includeNodeModules: boolean;    // 是否分析 node_modules
  includeTests: boolean;          // 是否分析测试文件

  // 风险评估
  criticalPatterns: string[];      // 关键文件模式 (如 **/main.ts, **/index.ts)
  ignorePatterns: string[];        // 忽略的分析模式

  // 输出
  verbose: boolean;
  outputFormat: 'json' | 'text' | 'html' | 'graph';
}
