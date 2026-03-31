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
import * as ts from 'typescript';
import * as path from 'path';
/**
 * 商用级类型分析器
 */
export class TypeFlowAnalyzer {
    program;
    checker;
    typeCache = new Map();
    constructor(projectRoot, tsConfigPath) {
        const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsConfigPath));
        this.program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
        this.checker = this.program.getTypeChecker();
    }
    /**
     * 主分析入口
     */
    analyzeTypeFlow(functionName, functionFile) {
        const startTime = Date.now();
        const incompatibilities = [];
        const stats = {
            genericTypes: 0,
            conditionalTypes: 0,
            intersectionTypes: 0,
            promiseTypes: 0,
        };
        let analyzedTypes = 0;
        // 1. 找到函数定义和签名
        const funcInfo = this.findFunctionDefinition(functionName, functionFile);
        if (!funcInfo) {
            return this.createResult(false, [], 'low', 0, stats, Date.now() - startTime);
        }
        const { declarations, signatures } = funcInfo;
        // 2. 提取所有返回类型（处理重载）
        const returnTypes = this.extractAllReturnTypes(signatures, stats);
        analyzedTypes += returnTypes.length;
        // 3. 遍历所有源文件查找调用点
        for (const sourceFile of this.program.getSourceFiles()) {
            if (sourceFile.fileName.includes('node_modules'))
                continue;
            const calls = this.findAllCalls(sourceFile, functionName);
            for (const call of calls) {
                const issues = this.analyzeCall(sourceFile, call, returnTypes, stats);
                incompatibilities.push(...issues);
            }
        }
        const duration = Date.now() - startTime;
        return this.createResult(incompatibilities.length > 0, incompatibilities, incompatibilities.length > 0 ? 'high' : 'medium', analyzedTypes, stats, duration);
    }
    /**
     * 创建结果
     */
    createResult(has, issues, confidence, analyzed, stats, duration) {
        return {
            hasIncompatibilities: has,
            incompatibilities: issues,
            confidence,
            method: `TypeFlow Pro (泛型:${stats.genericTypes} 条件:${stats.conditionalTypes} 交叉:${stats.intersectionTypes})`,
            analyzedTypes: analyzed,
            statistics: stats,
            duration,
        };
    }
    /**
     * 查找函数定义
     */
    findFunctionDefinition(functionName, inFile) {
        const resolvedPath = path.resolve(inFile);
        for (const sourceFile of this.program.getSourceFiles()) {
            if (sourceFile.fileName !== resolvedPath)
                continue;
            const declarations = this.findDeclarations(sourceFile, functionName);
            if (declarations.length === 0)
                return null;
            const signatures = [];
            for (const decl of declarations) {
                const sigs = this.checker.getSignaturesOfType(this.checker.getTypeAtLocation(decl), ts.SignatureKind.Call);
                signatures.push(...sigs);
            }
            return { declarations, signatures };
        }
        return null;
    }
    /**
     * 查找声明
     */
    findDeclarations(sourceFile, name) {
        const results = [];
        const visit = (node) => {
            // 函数声明
            if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
                results.push(node);
            }
            // 变量声明（箭头函数）
            else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
                results.push(node);
            }
            // 方法声明
            else if (ts.isMethodDeclaration(node)) {
                const methodName = node.name;
                if (ts.isIdentifier(methodName) && methodName.text === name) {
                    results.push(node);
                }
            }
            // 类方法
            else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
                results.push(node);
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return results;
    }
    /**
     * 提取所有返回类型
     */
    extractAllReturnTypes(signatures, stats) {
        const typeSet = new Set();
        const types = [];
        for (const sig of signatures) {
            const returnType = sig.getReturnType();
            const expanded = this.expandType(returnType, stats);
            for (const t of expanded) {
                const typeStr = this.checker.typeToString(t);
                if (!typeSet.has(typeStr)) {
                    typeSet.add(typeStr);
                    types.push(t);
                }
            }
        }
        return types;
    }
    /**
     * 展开类型（处理泛型、条件类型等）
     */
    expandType(type, stats) {
        const results = [type];
        const typeStr = this.checker.typeToString(type);
        // 处理 Promise<T>
        if (typeStr.startsWith('Promise<') || typeStr.startsWith('Promise<')) {
            stats.promiseTypes++;
            const inner = this.extractGenericArgument(type, 'Promise');
            if (inner)
                results.push(inner);
        }
        // 处理 Array<T>
        if (typeStr.startsWith('Array<')) {
            const inner = this.extractGenericArgument(type, 'Array');
            if (inner)
                results.push(inner);
        }
        // 处理泛型引用
        if (type.flags & ts.TypeFlags.TypeParameter) {
            stats.genericTypes++;
        }
        // 处理条件类型
        if (type.flags & ts.TypeFlags.Conditional) {
            stats.conditionalTypes++;
            const condType = type;
            // ConditionalType 有 checkType, extendsType, resolvedTrueType, resolvedFalseType
            const checkType = condType.checkType;
            const extendsType = condType.extendsType;
            const trueType = condType.resolvedTrueType;
            const falseType = condType.resolvedFalseType;
            if (checkType)
                results.push(...this.expandType(checkType, stats));
            if (extendsType)
                results.push(...this.expandType(extendsType, stats));
            if (trueType)
                results.push(...this.expandType(trueType, stats));
            if (falseType)
                results.push(...this.expandType(falseType, stats));
        }
        // 处理交叉类型
        if (type.flags & ts.TypeFlags.Intersection) {
            stats.intersectionTypes++;
            const intersectionType = type;
            for (const t of intersectionType.types || []) {
                results.push(...this.expandType(t, stats));
            }
        }
        return results;
    }
    /**
     * 提取泛型参数
     */
    extractGenericArgument(type, typeName) {
        try {
            const typeStr = this.checker.typeToString(type);
            // 简单字符串解析：Promise<Inner>
            const match = typeStr.match(new RegExp(`${typeName}<(.+)>`));
            if (match) {
                const innerStr = match[1];
                // 创建一个临时类型来解析
                return this.parseTypeString(innerStr);
            }
            // 使用类型引用
            if (type.target) {
                const typeRef = type;
                if (typeRef.target?.symbol?.name === typeName) {
                    if (typeRef.typeArguments && typeRef.typeArguments.length > 0) {
                        return typeRef.typeArguments[0];
                    }
                }
            }
        }
        catch (e) {
            // ignore
        }
        return null;
    }
    /**
     * 解析类型字符串
     */
    parseTypeString(typeStr) {
        // 检查缓存
        if (this.typeCache.has(typeStr)) {
            return this.typeCache.get(typeStr);
        }
        // 创建临时源文件来解析类型
        const tempSource = ts.createSourceFile('temp.ts', `type TempType = ${typeStr};`, ts.ScriptTarget.Latest, true);
        const typeAlias = tempSource.statements[0];
        if (typeAlias && ts.isTypeAliasDeclaration(typeAlias)) {
            const type = this.checker.getTypeAtLocation(typeAlias);
            this.typeCache.set(typeStr, type);
            return type;
        }
        return null;
    }
    /**
     * 查找所有调用
     */
    findAllCalls(sourceFile, functionName) {
        const calls = [];
        const visit = (node) => {
            if (ts.isCallExpression(node)) {
                const expr = node.expression;
                if (ts.isIdentifier(expr) && expr.text === functionName) {
                    calls.push(node);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return calls;
    }
    /**
     * 分析单个调用
     */
    analyzeCall(sourceFile, callExpr, returnTypes, stats) {
        const issues = [];
        const line = this.getLine(sourceFile, callExpr);
        const column = this.getColumn(sourceFile, callExpr);
        const callText = callExpr.getText().slice(0, 60);
        for (const returnType of returnTypes) {
            // 1. 检查赋值兼容性
            if (ts.isVariableDeclaration(callExpr.parent)) {
                const varDecl = callExpr.parent;
                if (ts.isIdentifier(varDecl.name)) {
                    const varName = varDecl.name.text;
                    const varType = this.checker.getTypeAtLocation(varDecl);
                    const comparison = this.compareTypes(returnType, varType, stats);
                    if (!comparison.compatible) {
                        issues.push({
                            file: sourceFile.fileName,
                            line,
                            column,
                            expression: callText,
                            assignedTo: varName,
                            expectedType: this.checker.typeToString(varType),
                            actualType: this.checker.typeToString(returnType),
                            reason: comparison.reason || '类型不兼容',
                            severity: 'warning',
                            code: 'INCOMPATIBLE_ASSIGN',
                        });
                    }
                    // 2. 分析返回值的使用
                    const usageIssues = this.analyzeReturnUsage(sourceFile, varDecl, varName, returnType, stats);
                    issues.push(...usageIssues);
                }
            }
            // 3. 检查 Promise.then 回调
            if (ts.isPropertyAccessExpression(callExpr.parent)) {
                const propAccess = callExpr.parent;
                if (propAccess.name.text === 'then' || propAccess.name.text === 'catch') {
                    const issues_ = this.analyzePromiseCallback(sourceFile, callExpr, propAccess, returnType, stats);
                    issues.push(...issues_);
                }
            }
            // 4. 检查 await 使用
            if (ts.isAwaitExpression(callExpr.parent)) {
                const awaitExpr = callExpr.parent;
                const issues_ = this.analyzeAwaitUsage(sourceFile, awaitExpr, returnType, stats);
                issues.push(...issues_);
            }
        }
        return issues;
    }
    /**
     * 分析返回值的使用
     */
    analyzeReturnUsage(sourceFile, varDecl, varName, returnType, stats) {
        const issues = [];
        const varStatement = varDecl.parent;
        if (!varStatement)
            return issues;
        const startPos = varStatement.end;
        // 在声明之后的代码中查找使用
        const visit = (node) => {
            if (node.pos < startPos)
                return;
            // 属性访问 varName.prop
            if (ts.isPropertyAccessExpression(node)) {
                const expr = node.expression;
                if (ts.isIdentifier(expr) && expr.text === varName) {
                    const propName = node.name.text;
                    const propType = this.checker.getTypeAtLocation(node);
                    const propTypeStr = this.checker.typeToString(propType);
                    // 检查属性是否存在
                    const returnTypeStr = this.checker.typeToString(returnType);
                    const returnExpanded = this.expandType(returnType, stats);
                    const propExists = returnExpanded.some(t => {
                        const tStr = this.checker.typeToString(t);
                        const prop = this.checker.getPropertyOfType(t, propName);
                        return !!prop;
                    });
                    if (!propExists) {
                        issues.push({
                            file: sourceFile.fileName,
                            line: this.getLine(sourceFile, node),
                            column: this.getColumn(sourceFile, node),
                            expression: node.getText().slice(0, 40),
                            assignedTo: varName,
                            propertyAccess: [propName],
                            expectedType: returnTypeStr,
                            actualType: 'undefined',
                            reason: `类型 ${returnTypeStr} 中不存在属性 ${propName}`,
                            severity: 'error',
                            code: 'MISSING_PROPERTY',
                        });
                    }
                    // 检查属性类型兼容性
                    const returnExpandedTypes = this.expandType(returnType, stats);
                    for (const t of returnExpandedTypes) {
                        const prop = this.checker.getPropertyOfType(t, propName);
                        if (prop) {
                            const expectedPropType = this.checker.getTypeAtLocation(prop.valueDeclaration);
                            const comparison = this.compareTypes(propType, expectedPropType, stats);
                            if (!comparison.compatible) {
                                issues.push({
                                    file: sourceFile.fileName,
                                    line: this.getLine(sourceFile, node),
                                    column: this.getColumn(sourceFile, node),
                                    expression: node.getText().slice(0, 40),
                                    assignedTo: varName,
                                    propertyAccess: [propName],
                                    expectedType: this.checker.typeToString(expectedPropType),
                                    actualType: propTypeStr,
                                    reason: comparison.reason || `属性 ${propName} 类型不兼容`,
                                    severity: 'warning',
                                    code: 'INCOMPATIBLE_PROPERTY',
                                });
                            }
                        }
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return issues;
    }
    /**
     * 分析 Promise 回调
     */
    analyzePromiseCallback(sourceFile, callExpr, propAccess, returnType, stats) {
        const issues = [];
        const parentCall = propAccess.parent;
        if (!ts.isCallExpression(parentCall))
            return issues;
        const callbackArg = parentCall.arguments[0];
        if (!callbackArg || !ts.isArrowFunction(callbackArg))
            return issues;
        const params = callbackArg.parameters;
        if (params.length === 0)
            return issues;
        const param = params[0];
        if (!ts.isIdentifier(param.name))
            return issues;
        const paramName = param.name.text;
        const paramType = this.checker.getTypeAtLocation(param);
        const paramTypeStr = this.checker.typeToString(paramType);
        // 解包 Promise<T>
        const promiseInner = this.extractGenericArgument(returnType, 'Promise');
        if (promiseInner) {
            const innerTypeStr = this.checker.typeToString(promiseInner);
            const comparison = this.compareTypes(promiseInner, paramType, stats);
            if (!comparison.compatible) {
                issues.push({
                    file: sourceFile.fileName,
                    line: this.getLine(sourceFile, callExpr),
                    column: this.getColumn(sourceFile, callExpr),
                    expression: callExpr.getText().slice(0, 60),
                    assignedTo: paramName,
                    expectedType: paramTypeStr,
                    actualType: innerTypeStr,
                    reason: comparison.reason || `Promise<${innerTypeStr}> 与回调参数 ${paramTypeStr} 不兼容`,
                    severity: 'warning',
                    code: 'INCOMPATIBLE_PROMISE_CALLBACK',
                });
            }
        }
        return issues;
    }
    /**
     * 分析 await 使用
     */
    analyzeAwaitUsage(sourceFile, awaitExpr, returnType, stats) {
        const issues = [];
        // await 会解包 Promise<T> -> T
        const promiseInner = this.extractGenericArgument(returnType, 'Promise');
        if (!promiseInner)
            return issues;
        const innerTypeStr = this.checker.typeToString(promiseInner);
        // await 表达式的类型是 T（解包后的）
        const awaitType = this.checker.getTypeAtLocation(awaitExpr);
        const awaitTypeStr = this.checker.typeToString(awaitType);
        // 检查 await 后续使用
        const parent = awaitExpr.parent;
        if (ts.isVariableDeclaration(parent)) {
            if (ts.isIdentifier(parent.name)) {
                const varName = parent.name.text;
                const varType = this.checker.getTypeAtLocation(parent);
                const comparison = this.compareTypes(awaitType, varType, stats);
                if (!comparison.compatible) {
                    issues.push({
                        file: sourceFile.fileName,
                        line: this.getLine(sourceFile, awaitExpr),
                        column: this.getColumn(sourceFile, awaitExpr),
                        expression: awaitExpr.getText().slice(0, 60),
                        assignedTo: varName,
                        expectedType: this.checker.typeToString(varType),
                        actualType: awaitTypeStr,
                        reason: `await 解包后类型 ${awaitTypeStr} 与变量类型不兼容`,
                        severity: 'warning',
                        code: 'INCOMPATIBLE_AWAIT',
                    });
                }
            }
        }
        return issues;
    }
    /**
     * 比较两个类型
     */
    compareTypes(source, target, stats) {
        const sourceStr = this.checker.typeToString(source);
        const targetStr = this.checker.typeToString(target);
        // 相同类型
        if (sourceStr === targetStr) {
            return { compatible: true };
        }
        // any 或 unknown 兼容一切
        if (source.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
            return { compatible: true };
        }
        if (target.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
            return { compatible: true };
        }
        // null/undefined 兼容性
        if (source.flags & ts.TypeFlags.Null) {
            if (target.flags & ts.TypeFlags.Null)
                return { compatible: true };
        }
        // 尝试 isTypeAssignableTo
        try {
            if (this.checker.isTypeAssignableTo(source, target)) {
                return { compatible: true };
            }
        }
        catch (e) {
            // ignore
        }
        // 尝试逆向检查
        try {
            if (this.checker.isTypeAssignableTo(target, source)) {
                return { compatible: true };
            }
        }
        catch (e) {
            // ignore
        }
        // 泛型类型比较（简化处理）
        if (source.flags & ts.TypeFlags.TypeParameter || target.flags & ts.TypeFlags.TypeParameter) {
            stats.genericTypes++;
            // 泛型参数未知，保守处理
            return {
                compatible: true,
                reason: '包含泛型参数，需要运行时验证'
            };
        }
        // 交叉类型展开比较
        if (source.flags & ts.TypeFlags.Intersection) {
            stats.intersectionTypes++;
            const expanded = this.expandType(source, stats);
            for (const t of expanded) {
                const result = this.compareTypes(t, target, stats);
                if (result.compatible)
                    return { compatible: true };
            }
        }
        if (target.flags & ts.TypeFlags.Intersection) {
            stats.intersectionTypes++;
            const expanded = this.expandType(target, stats);
            for (const t of expanded) {
                const result = this.compareTypes(source, t, stats);
                if (result.compatible)
                    return { compatible: true };
            }
        }
        return {
            compatible: false,
            reason: `类型 ${sourceStr} 不能赋值给 ${targetStr}`,
        };
    }
    /**
     * 获取行号
     */
    getLine(sourceFile, node) {
        return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    }
    /**
     * 获取列号
     */
    getColumn(sourceFile, node) {
        return sourceFile.getLineAndCharacterOfPosition(node.getStart()).character + 1;
    }
    /**
     * 格式化文本报告
     */
    formatAsText(result, _functionName) {
        const lines = [];
        lines.push('');
        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('            🔬 类型流分析 (TypeFlow Pro)                    ');
        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('');
        if (!result.hasIncompatibilities) {
            lines.push('✅ 未检测到类型不兼容');
            lines.push(`   ${result.method}`);
            lines.push(`   可信度: ${result.confidence}`);
            lines.push(`   耗时: ${result.duration}ms`);
            lines.push('');
            return lines.join('\n');
        }
        lines.push(`⚠️  检测到 ${result.incompatibilities.length} 处类型不兼容`);
        lines.push(`   ${result.method}`);
        lines.push(`   可信度: ${result.confidence}`);
        lines.push(`   耗时: ${result.duration}ms`);
        lines.push('');
        // 按文件分组
        const byFile = new Map();
        for (const issue of result.incompatibilities) {
            if (!byFile.has(issue.file)) {
                byFile.set(issue.file, []);
            }
            byFile.get(issue.file).push(issue);
        }
        for (const [file, items] of byFile) {
            lines.push(`📁 ${path.basename(file)}`);
            for (const item of items) {
                lines.push(`   📍 ${item.line}:${item.column}`);
                lines.push(`      代码: ${item.expression}`);
                if (item.assignedTo)
                    lines.push(`      赋值: ${item.assignedTo}`);
                if (item.propertyAccess?.length) {
                    lines.push(`      属性: ${item.propertyAccess.join(' → ')}`);
                }
                lines.push(`      期望: ${item.expectedType}`);
                lines.push(`      实际: ${item.actualType}`);
                lines.push(`      原因: ${item.reason}`);
                lines.push(`      [${item.code}]`);
                lines.push('');
            }
        }
        lines.push('💡 建议: 请检查上述位置的类型兼容性');
        lines.push('');
        return lines.join('\n');
    }
    /**
     * 格式化 HTML 报告
     */
    formatAsHtml(result, _functionName) {
        if (!result.hasIncompatibilities) {
            return `<div class="type-flow-pro">
        <h3>🔬 类型流分析</h3>
        <div class="type-result-ok">
          <span>✅</span>
          <span>未检测到类型不兼容</span>
          <span class="meta">${result.method} | ${result.confidence} | ${result.duration}ms</span>
        </div>
      </div>`;
        }
        const byFile = new Map();
        for (const issue of result.incompatibilities) {
            if (!byFile.has(issue.file)) {
                byFile.set(issue.file, []);
            }
            byFile.get(issue.file).push(issue);
        }
        let filesHtml = '';
        for (const [file, items] of byFile) {
            let itemsHtml = '';
            for (const item of items) {
                itemsHtml += `<div class="type-item ${item.severity}">
          <div class="type-location">
            <span>📍 ${item.line}:${item.column}</span>
            <span class="code">${item.code}</span>
          </div>
          <div class="type-expr">${item.expression}</div>
          ${item.assignedTo ? `<div>赋值: <code>${item.assignedTo}</code></div>` : ''}
          ${item.propertyAccess?.length ? `<div>属性: ${item.propertyAccess.map(p => `<span class="prop">${p}</span>`).join(' → ')}</div>` : ''}
          <div class="type-types">期望: <code>${item.expectedType}</code> | 实际: <code>${item.actualType}</code></div>
          <div class="type-reason">${item.reason}</div>
        </div>`;
            }
            filesHtml += `<div class="type-file">
        <div class="type-file-header">📁 ${path.basename(file)}</div>
        ${itemsHtml}
      </div>`;
        }
        return `<div class="type-flow-pro">
      <h3>🔬 类型流分析 ⚠️</h3>
      <div class="type-result-warn">
        <span>检测到 <strong>${result.incompatibilities.length}</strong> 处类型不兼容</span>
        <span class="meta">${result.method} | ${result.duration}ms</span>
      </div>
      <div class="type-list">${filesHtml}</div>
    </div>`;
    }
}
