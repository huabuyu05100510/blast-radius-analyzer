/**
 * DependencyGraph - 依赖图可视化
 *
 * 生成交互式依赖图和影响链图形
 */
import type { ReferenceInfo, SymbolInfo } from './SymbolAnalyzer.js';
export interface GraphNode {
    id: string;
    label: string;
    type: 'file' | 'symbol' | 'category';
    category?: string;
    risk?: 'low' | 'medium' | 'high' | 'critical';
    impact?: number;
}
export interface GraphEdge {
    source: string;
    target: string;
    type: 'import' | 'call' | 'type' | 'export' | 'property';
    weight?: number;
}
export interface DependencyGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}
export declare class DependencyGraphBuilder {
    /**
     * 构建依赖图
     */
    build(symbolInfo: SymbolInfo, references: ReferenceInfo[], changedFile: string): DependencyGraph;
    /**
     * 分类文件
     */
    private categorizeFile;
    /**
     * 映射引用类型到边类型
     */
    private mapReferenceType;
    /**
     * 获取边权重
     */
    private getEdgeWeight;
    /**
     * 生成交互式 HTML 图表
     */
    generateInteractiveHtml(graph: DependencyGraph, title: string): string;
    /**
     * 生成传播路径图
     */
    generatePropagationHtml(paths: Array<{
        from: string;
        to: string;
        path: string[];
        type: string;
    }>, title: string): string;
}
