/**
 * BlastRadiusAnalyzer - 改动影响范围分析器
 *
 * 核心功能：
 * 1. 接收代码改动信息
 * 2. 在依赖图上追溯影响范围
 * 3. 评估风险等级
 * 4. 生成详细的影响报告
 */
import type { CodeChange, ImpactScope, AnalyzerConfig } from '../types.js';
export declare class BlastRadiusAnalyzer {
    private config;
    private graph;
    constructor(config: AnalyzerConfig);
    /**
     * 初始化：构建项目依赖图
     */
    initialize(): Promise<void>;
    /**
     * 分析单个改动的爆炸半径
     */
    analyzeChange(change: CodeChange): ImpactScope;
    /**
     * 分析多个改动的综合影响
     */
    analyzeChanges(changes: CodeChange[]): ImpactScope[];
    /**
     * 合并多个 ImpactScope 的综合影响
     */
    mergeImpacts(scopes: ImpactScope[]): ImpactScope;
    /**
     * 找到改动对应的节点
     */
    private findChangedNodes;
    /**
     * 追溯影响范围 (BFS)
     */
    private traceImpact;
    /**
     * 查找连接两节点的边
     */
    private findEdge;
    /**
     * 计算统计信息
     */
    private computeStats;
    /**
     * 按深度分组
     */
    private groupByDepth;
    /**
     * 计算详细的受影响文件
     */
    private computeAffectedFiles;
    /**
     * 评估边类型的影响
     */
    private evaluateEdgeType;
    /**
     * 计算传播路径
     */
    private computePropagationPaths;
    /**
     * 计算风险等级
     */
    private calculateRiskLevel;
    /**
     * 识别高风险影响
     */
    private identifyHighRiskImpacts;
    /**
     * 解释风险
     */
    private explainRisk;
    /**
     * 建议缓解措施
     */
    private suggestMitigation;
    /**
     * 估算破坏性变更数量
     */
    private estimateBreakingChanges;
    /**
     * 生成建议
     */
    private generateRecommendations;
    /**
     * 去重建议
     */
    private deduplicateRecommendations;
    /**
     * 简单 glob 模式匹配
     */
    private matchPattern;
    /**
     * 创建空的影响范围
     */
    private createEmptyScope;
}
