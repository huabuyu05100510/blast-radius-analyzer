/**
 * TypePropagationAnalyzer - 类型传播分析
 *
 * 追踪函数返回类型的变化如何影响使用该函数的地方
 *
 * 原理：
 * 1. 获取函数的返回类型
 * 2. 如果返回的是命名类型（interface/type），找到所有使用该类型的地方
 * 3. 报告哪些代码可能受影响
 */
export interface TypeReference {
    file: string;
    line: number;
    column: number;
    typeName: string;
    usage: 'variable' | 'propertyAccess' | 'functionCall' | 'return' | 'parameter';
    context: string;
    affectedSymbol?: string;
}
export interface TypePropagationResult {
    functionName: string;
    file: string;
    returnType: string;
    typeDefinitionFile?: string;
    references: TypeReference[];
    affectedVariables: Array<{
        variableName: string;
        file: string;
        line: number;
        accesses: string[];
    }>;
}
export declare class TypePropagationAnalyzer {
    private project;
    private projectRoot;
    private checker;
    constructor(projectRoot: string, tsConfigPath?: string);
    /**
     * 分析函数返回类型的影响
     */
    analyzeFunctionReturnType(functionName: string, inFile: string): TypePropagationResult | null;
    /**
     * 查找类型的使用位置
     */
    private findTypeUsages;
    /**
     * 查找受影响的变量（调用函数并访问其属性的变量）
     */
    private findAffectedVariables;
    /**
     * 查找对变量的属性访问
     */
    private findPropertyAccessesOnVariable;
    /**
     * 生成类型传播报告
     */
    generateReport(result: TypePropagationResult): string;
}
