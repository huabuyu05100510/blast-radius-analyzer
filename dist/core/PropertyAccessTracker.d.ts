/**
 * PropertyAccessTracker - 属性访问追踪器
 *
 * 追踪函数返回值的属性访问，帮助理解类型传播
 */
export interface PropertyAccess {
    file: string;
    line: number;
    variableName: string;
    accessChain: string[];
    fullExpression: string;
    codeContext: string;
}
export interface CallSiteAnalysis {
    functionName: string;
    file: string;
    line: number;
    callExpression: string;
    returnedTo?: string;
    codeContext: string;
    propertyAccesses: PropertyAccess[];
}
export declare class PropertyAccessTracker {
    private program;
    private checker;
    private projectRoot;
    constructor(projectRoot: string, tsConfigPath: string);
    /**
     * 分析函数调用的属性访问链
     */
    analyzeFunctionCalls(functionName: string, inFiles?: string[]): CallSiteAnalysis[];
    /**
     * 分析单个文件
     */
    private analyzeFile;
    /**
     * 分析调用点
     */
    private analyzeCallSite;
    /**
     * 查找变量被访问的属性链
     */
    private findPropertyAccesses;
    /**
     * 获取属性访问的基标识符
     */
    private getBaseIdentifier;
    /**
     * 构建属性访问链
     */
    private buildPropertyChain;
    /**
     * 生成报告
     */
    generateReport(analyses: CallSiteAnalysis[]): string;
}
