/**
 * SymbolAnalyzer - 符号级分析器
 *
 * 使用 ts-morph 的 findReferences() 追踪符号的所有引用
 * 比 import 追踪强大得多
 */
import { Project, Node, SourceFile } from 'ts-morph';
export interface SymbolLocation {
    file: string;
    line: number;
    column: number;
    node: Node;
    nodeKind: string;
    context: string;
}
export interface SymbolInfo {
    name: string;
    kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum' | 'property' | 'method' | 'parameter' | 'unknown';
    file: string;
    line: number;
    declaration: Node;
    exports: string[];
}
export interface ReferenceInfo {
    symbol: SymbolInfo;
    location: SymbolLocation;
    referenceType: 'definition' | 'import' | 'call' | 'type' | 'assign' | 'property' | 'export' | 'extend' | 'implement' | 'decorate' | 'parameter' | 'generic';
    impactLevel: number;
}
export declare class SymbolAnalyzer {
    private project;
    private projectRoot;
    private cache;
    private referenceCache;
    constructor(projectRoot: string, tsConfigPath?: string);
    /**
     * 添加源文件
     */
    addSourceFiles(patterns: string[]): void;
    /**
     * 递归扫描目录获取文件列表
     */
    private scanDirectory;
    /**
     * 自动发现并添加所有源文件
     */
    discoverSourceFiles(includeTests?: boolean): void;
    /**
     * 获取项目
     */
    getProject(): Project;
    /**
     * 获取所有源文件
     */
    getSourceFiles(): SourceFile[];
    /**
     * 查找文件的主要导出符号
     * 返回默认导出或第一个命名导出
     */
    findMainExport(filePath: string): SymbolInfo | null;
    /**
     * 获取节点对应的符号类型
     */
    private getNodeKind;
    /**
     * 查找符号信息
     */
    findSymbol(symbolName: string, inFile?: string): SymbolInfo | null;
    /**
     * 查找符号的所有引用
     * 使用 TypeScript Language Service 的 findReferences API 实现真正的符号级追踪
     */
    findAllReferences(symbolName: string, inFile?: string): ReferenceInfo[];
    /**
     * 回退方案：使用文本匹配查找引用
     */
    private findAllReferencesFallback;
    /**
     * 根据节点分类引用类型
     */
    private classifyReferenceByNode;
    /**
     * 分类引用类型
     */
    private classifyReference;
    /**
     * 获取节点上下文描述
     */
    private getNodeContext;
    /**
     * 创建符号信息
     */
    private createSymbolInfo;
    /**
     * 去重引用
     */
    private deduplicateReferences;
    /**
     * 分析改动的影响范围（递归深度分析）
     */
    analyzeImpact(symbolName: string, changeType?: 'modify' | 'delete' | 'rename', inFile?: string, maxDepth?: number): {
        symbol: SymbolInfo | null;
        references: ReferenceInfo[];
        callGraph: Map<string, ReferenceInfo[]>;
        typeDependencies: ReferenceInfo[];
        exportDependents: ReferenceInfo[];
        downstreamChain: DownstreamNode[];
        impactScore: number;
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
    };
    /**
     * 下游节点
     */
    private downstreamNodes;
    /**
     * 递归收集下游引用
     */
    private collectDownstreamReferences;
    /**
     * 构建下游链路
     */
    private buildDownstreamChain;
    /**
     * 分类文件
     */
    private categorizeFile;
}
export interface DownstreamNode {
    depth: number;
    file: string;
    fileName: string;
    type: string;
    callSites: Array<{
        line: number;
        calledFunction: string;
        context: string;
    }>;
    references: ReferenceInfo[];
}
