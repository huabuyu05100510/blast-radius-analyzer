/**
 * PropagationTracker - 非函数符号的传播追踪器
 *
 * 追踪常量、类型、对象等非函数符号如何传播到下游
 */
export interface PropagationNode {
    symbol: string;
    file: string;
    line: number;
    type: 'constant' | 'variable' | 'type' | 'object' | 'property' | 'functionArg' | 'return' | 'nested';
    value?: string;
    parent?: string;
    children: PropagationNode[];
    context: string;
}
export declare class PropagationTracker {
    private project;
    private projectRoot;
    constructor(projectRoot: string);
    /**
     * 追踪符号的传播路径
     */
    trace(symbolName: string, filePath: string, maxDepth?: number): PropagationNode[];
    /**
     * 查找嵌套属性（如在对象字面量中定义的属性）
     */
    private findNestedProperty;
    /**
     * 查找对象字面量中属性的父对象名
     */
    private findParentObjectName;
    /**
     * 查找符号定义
     */
    private findDefinition;
    /**
     * 查找符号的所有引用位置
     */
    private findReferences;
    /**
     * 获取上下文代码
     */
    private getContextCode;
    /**
     * 构建传播树
     */
    private buildPropagationTree;
    /**
     * 分类符号的使用方式
     */
    private classifyUsage;
    /**
     * 追踪常量使用的上下文（如模板字符串、函数调用等）
     */
    private traceConstantContext;
    /**
     * 获取赋值的变量名
     */
    private getAssignedVariable;
    /**
     * 获取包含函数名
     */
    private getContainingFunction;
    /**
     * 追踪函数返回值的用法
     */
    private traceFunctionReturnUsage;
    /**
     * 格式化传播树为文本
     */
    formatAsText(nodes: PropagationNode[], indent?: string): string;
    private getTypeIcon;
}
