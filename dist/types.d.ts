/**
 * Blast Radius Analyzer - Type Definitions
 * 分析代码改动影响范围的核心类型
 */
export interface CodeChange {
    file: string;
    type: ChangeType;
    symbol?: string;
    line?: number;
    diff?: string;
}
export type ChangeType = 'add' | 'delete' | 'modify' | 'rename';
export interface DependencyNode {
    id: string;
    kind: NodeKind;
    file?: string;
    line?: number;
    exports?: string[];
    imports?: ImportInfo[];
    dependents: string[];
    depth: number;
}
export type NodeKind = 'file' | 'function' | 'class' | 'interface' | 'type' | 'variable' | 'export';
export interface ImportInfo {
    source: string;
    imported: string[];
    isReExport: boolean;
}
export interface DependencyGraph {
    nodes: Map<string, DependencyNode>;
    edges: Edge[];
    entryPoints: string[];
}
export interface Edge {
    from: string;
    to: string;
    type: EdgeType;
    symbol?: string;
}
export type EdgeType = 'import' | 'extend' | 'implement' | 'type-ref' | 'call' | 'property-access' | 'param-type';
export interface ImpactScope {
    changedFile: string;
    timestamp: string;
    stats: ImpactStats;
    levels: ImpactLevel[];
    affectedFiles: AffectedFile[];
    propagationPaths: PropagationPath[];
    highRiskImpacts: HighRiskImpact[];
    recommendations: string[];
}
export interface ImpactStats {
    totalAffectedFiles: number;
    directDependencies: number;
    transitiveDependencies: number;
    filesWithBreakingChanges: number;
    criticalFiles: number;
    estimatedRippleDepth: number;
}
export interface ImpactLevel {
    depth: number;
    description: string;
    files: string[];
    nodeCount: number;
}
export interface AffectedFile {
    file: string;
    kind: NodeKind;
    changeType: ChangeType;
    impactLevel: number;
    impactFactors: ImpactFactor[];
    line?: number;
}
export interface ImpactFactor {
    factor: string;
    weight: number;
    reason: string;
}
export interface PropagationPath {
    from: string;
    to: string;
    path: string[];
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
export interface AnalyzerConfig {
    projectRoot: string;
    tsConfigPath?: string;
    maxDepth: number;
    includeNodeModules: boolean;
    includeTests: boolean;
    criticalPatterns: string[];
    ignorePatterns: string[];
    verbose: boolean;
    outputFormat: 'json' | 'text' | 'html' | 'graph';
}
