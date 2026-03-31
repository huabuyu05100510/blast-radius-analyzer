/**
 * ImpactTracer - 追踪改动的传播路径
 *
 * 基于符号级分析，构建完整的依赖图和影响链
 */
import type { AnalyzerConfig } from '../types.js';
import { SymbolInfo, ReferenceInfo } from './SymbolAnalyzer.js';
export interface ImpactScope {
    changedFile: string;
    changedSymbol?: string;
    changeType: 'modify' | 'delete' | 'rename' | 'add';
    timestamp: string;
    symbolInfo: SymbolInfo | null;
    stats: {
        totalAffectedFiles: number;
        directReferences: number;
        indirectReferences: number;
        callSites: number;
        typeReferences: number;
        impactScore: number;
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
    };
    affectedFiles: AffectedFile[];
    propagationPaths: PropagationPath[];
    categorized: {
        definitions: ReferenceInfo[];
        calls: ReferenceInfo[];
        types: ReferenceInfo[];
        exports: ReferenceInfo[];
        extends: ReferenceInfo[];
        implements: ReferenceInfo[];
        properties: ReferenceInfo[];
    };
    recommendations: string[];
}
export interface AffectedFile {
    file: string;
    line: number;
    references: ReferenceInfo[];
    impactFactors: ImpactFactor[];
    category: string;
}
export interface ImpactFactor {
    type: string;
    weight: number;
    description: string;
}
export interface PropagationPath {
    from: string;
    to: string;
    path: string[];
    type: string;
}
export declare class ImpactTracer {
    private analyzer;
    private propagationTracker;
    private projectRoot;
    private config;
    constructor(projectRoot: string, tsConfigPath: string, config: AnalyzerConfig);
    /**
     * 初始化
     */
    initialize(): Promise<void>;
    /**
     * 追踪改动影响
     */
    traceImpact(file: string, symbol?: string, changeType?: 'modify' | 'delete' | 'rename' | 'add'): Promise<ImpactScope>;
    /**
     * 从文件名推断主要符号
     */
    private inferMainSymbol;
    /**
     * 分类受影响的文件
     */
    private categorizeAffectedFiles;
    /**
     * 计算影响因子
     */
    private computeImpactFactors;
    /**
     * 分类文件
     */
    private categorizeFile;
    /**
     * 将传播节点转换为传播路径
     */
    private convertPropagationNodesToPaths;
    /**
     * 构建传播路径
     */
    private buildPropagationPaths;
    /**
     * 生成建议
     */
    private generateRecommendations;
}
