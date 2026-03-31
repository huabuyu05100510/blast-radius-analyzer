/**
 * CallStackBuilder - 调用栈视图构建器
 *
 * 从改动点向上追踪，构建完整的调用链视图
 */
export interface CallStackNode {
    name: string;
    file: string;
    line: number;
    type: 'function' | 'arrow' | 'method' | 'component';
    children: CallStackNode[];
    /** 调用此函数的代码（父节点的调用点） */
    callSite?: {
        line: number;
        expression: string;
    };
}
export interface CallStackTree {
    root: CallStackNode;
    depth: number;
    path: string[];
}
export declare class CallStackBuilder {
    private project;
    private projectRoot;
    constructor(projectRoot: string, tsConfigPath: string);
    /**
     * 添加源文件到项目
     */
    addSourceFiles(patterns: string[]): void;
    /**
     * 构建调用栈视图（从改动点向上追踪到入口）
     */
    buildCallStack(targetSymbol: string, targetFile: string): CallStackTree | null;
    /**
     * 查找符号定义
     */
    private findSymbolDefinition;
    /**
     * 递归追踪调用者
     */
    private traceCallers;
    /**
     * 查找调用某个函数的所有地方
     */
    private findCallers;
    /**
     * 在节点内查找对某个符号的调用
     */
    private findCallsInNode;
    /**
     * 计算树深度
     */
    private calculateDepth;
    /**
     * 构建路径字符串
     */
    private buildPathString;
    /**
     * 生成文本格式的调用栈视图
     */
    formatAsText(tree: CallStackTree, changedSymbol: string): string;
}
