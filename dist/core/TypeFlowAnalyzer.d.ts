/**
 * TypeFlowAnalyzer - 商用级 TypeScript 类型流分析器
 *
 * 完整支持：
 * - 泛型类型 T<U>
 * - 条件类型 T extends U ? X : Y
 * - 交叉类型 A & B
 * - 映射类型 { [K in keyof T]: ... }
 * - infer 关键字
 * - Promise/Array/Observable 等内置类型
 * - 类型推导和比较
 */
export interface TypeIncompatibility {
    file: string;
    line: number;
    column: number;
    expression: string;
    assignedTo?: string;
    propertyAccess?: string[];
    expectedType: string;
    actualType: string;
    reason: string;
    severity: 'error' | 'warning';
    code: string;
}
export interface TypeFlowResult {
    hasIncompatibilities: boolean;
    incompatibilities: TypeIncompatibility[];
    confidence: 'high' | 'medium' | 'low';
    method: string;
    analyzedTypes: number;
    duration: number;
    statistics: {
        genericTypes: number;
        conditionalTypes: number;
        intersectionTypes: number;
        promiseTypes: number;
    };
}
/**
 * 商用级类型分析器
 */
export declare class TypeFlowAnalyzer {
    private program;
    private checker;
    private typeCache;
    constructor(projectRoot: string, tsConfigPath: string);
    /**
     * 主分析入口
     */
    analyzeTypeFlow(functionName: string, functionFile: string): TypeFlowResult;
    /**
     * 创建结果
     */
    private createResult;
    /**
     * 查找函数定义
     */
    private findFunctionDefinition;
    /**
     * 查找声明
     */
    private findDeclarations;
    /**
     * 提取所有返回类型
     */
    private extractAllReturnTypes;
    /**
     * 展开类型（处理泛型、条件类型等）
     */
    private expandType;
    /**
     * 提取泛型参数
     */
    private extractGenericArgument;
    /**
     * 解析类型字符串
     */
    private parseTypeString;
    /**
     * 查找所有调用
     */
    private findAllCalls;
    /**
     * 分析单个调用
     */
    private analyzeCall;
    /**
     * 分析返回值的使用
     */
    private analyzeReturnUsage;
    /**
     * 分析 Promise 回调
     */
    private analyzePromiseCallback;
    /**
     * 分析 await 使用
     */
    private analyzeAwaitUsage;
    /**
     * 比较两个类型
     */
    private compareTypes;
    /**
     * 获取行号
     */
    private getLine;
    /**
     * 获取列号
     */
    private getColumn;
    /**
     * 格式化文本报告
     */
    formatAsText(result: TypeFlowResult, _functionName: string): string;
    /**
     * 格式化 HTML 报告
     */
    formatAsHtml(result: TypeFlowResult, _functionName: string): string;
}
