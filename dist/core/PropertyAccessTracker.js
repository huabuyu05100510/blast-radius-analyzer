/**
 * PropertyAccessTracker - 属性访问追踪器
 *
 * 追踪函数返回值的属性访问，帮助理解类型传播
 */
import * as ts from 'typescript';
import * as path from 'path';
export class PropertyAccessTracker {
    program;
    checker;
    projectRoot;
    constructor(projectRoot, tsConfigPath) {
        this.projectRoot = projectRoot;
        const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsConfigPath));
        this.program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
        this.checker = this.program.getTypeChecker();
    }
    /**
     * 分析函数调用的属性访问链
     */
    analyzeFunctionCalls(functionName, inFiles) {
        const results = [];
        for (const sourceFile of this.program.getSourceFiles()) {
            const filePath = sourceFile.fileName;
            if (filePath.includes('node_modules') || filePath.includes('.d.ts'))
                continue;
            // 如果指定了文件列表，只分析这些文件
            if (inFiles && inFiles.length > 0) {
                const basename = filePath.replace(/^.*[/\\]/, '');
                if (!inFiles.some(f => filePath.includes(f) || f.includes(basename))) {
                    continue;
                }
            }
            const analysis = this.analyzeFile(sourceFile, functionName);
            if (analysis) {
                results.push(...analysis);
            }
        }
        return results;
    }
    /**
     * 分析单个文件
     */
    analyzeFile(sourceFile, functionName) {
        const results = [];
        const visit = (node) => {
            // 找函数调用
            if (ts.isCallExpression(node)) {
                const expr = node.expression;
                if (ts.isIdentifier(expr) && expr.text === functionName) {
                    const callSite = this.analyzeCallSite(node, sourceFile, functionName);
                    if (callSite) {
                        results.push(callSite);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return results;
    }
    /**
     * 分析调用点
     */
    analyzeCallSite(callExpr, sourceFile, functionName) {
        const line = ts.getLineAndCharacterOfPosition(sourceFile, callExpr.getStart()).line + 1;
        // 获取调用行的完整代码上下文
        const sourceText = sourceFile.getFullText();
        const lineStarts = sourceFile.getLineStarts();
        const lineStart = lineStarts[line - 1];
        const lineEnd = lineStarts[line] || sourceText.length;
        const codeContext = sourceText.slice(lineStart, lineEnd).trim();
        // 检查是否在 Promise.all 中
        let inPromiseAll = false;
        let arrayIndex = -1;
        let parent = callExpr.parent;
        if (ts.isArrayLiteralExpression(parent)) {
            const elements = parent.elements;
            arrayIndex = elements.indexOf(callExpr);
            const grandParent = parent.parent;
            if (ts.isCallExpression(grandParent) && ts.isIdentifier(grandParent.expression)) {
                if (grandParent.expression.text === 'Promise.all') {
                    inPromiseAll = true;
                }
            }
        }
        // 获取调用表达式的文本
        const callText = callExpr.getText().slice(0, 50);
        // 查找返回值被赋值给的变量
        let assignedTo;
        let current = callExpr;
        while (current.parent) {
            const parent = current.parent;
            // 直接赋值: const x = call()
            if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
                assignedTo = parent.name.text;
                break;
            }
            // 数组解构: const [a, b] = await Promise.all([call()])
            if (ts.isArrayLiteralExpression(parent)) {
                const elements = parent.elements;
                const idx = elements.indexOf(current);
                if (idx >= 0) {
                    // parent is ArrayLiteralExpression, go up to find Promise.all CallExpression
                    const arrayLiteralParent = parent.parent;
                    if (!ts.isCallExpression(arrayLiteralParent))
                        continue;
                    // Check if it's Promise.all - handle both Promise.all and Promise.all<any>
                    let isPromiseAll = false;
                    const callExpr = arrayLiteralParent.expression;
                    if (ts.isIdentifier(callExpr) && callExpr.text === 'Promise.all') {
                        isPromiseAll = true;
                    }
                    else if (ts.isPropertyAccessExpression(callExpr)) {
                        // Handle Promise.all<any> where expression is PropertyAccessExpression
                        const propExpr = callExpr.expression;
                        const propName = callExpr.name.text;
                        if (ts.isIdentifier(propExpr) && propExpr.text === 'Promise' && propName === 'all') {
                            isPromiseAll = true;
                        }
                    }
                    if (!isPromiseAll)
                        continue;
                    // Now go up from Promise.all CallExpression to find AwaitExpression
                    const promiseAllParent = arrayLiteralParent.parent;
                    if (!ts.isAwaitExpression(promiseAllParent))
                        continue;
                    // Finally find VariableDeclaration
                    const varDeclParent = promiseAllParent.parent;
                    if (!ts.isVariableDeclaration(varDeclParent))
                        continue;
                    // Check if name is array binding pattern (const [a, b] = ...)
                    if (!ts.isArrayBindingPattern(varDeclParent.name))
                        continue;
                    const bindingPattern = varDeclParent.name;
                    const bindingElements = bindingPattern.elements;
                    if (bindingElements[idx] && !ts.isOmittedExpression(bindingElements[idx])) {
                        const bindingElement = bindingElements[idx];
                        if (ts.isIdentifier(bindingElement.name)) {
                            assignedTo = bindingElement.name.text;
                            break;
                        }
                    }
                }
            }
            current = parent;
        }
        // 查找后续的属性访问
        const propertyAccesses = assignedTo
            ? this.findPropertyAccesses(sourceFile, assignedTo, callExpr)
            : [];
        const analysis = {
            functionName: functionName, // Use the parameter
            file: sourceFile.fileName,
            line,
            callExpression: callText,
            returnedTo: assignedTo,
            codeContext,
            propertyAccesses,
        };
        return analysis;
    }
    /**
     * 查找变量被访问的属性链
     */
    findPropertyAccesses(sourceFile, variableName, afterNode) {
        const accesses = [];
        // 获取源代码文本
        const sourceText = sourceFile.getFullText();
        const lineStarts = sourceFile.getLineStarts();
        // 查找所有对 variableName 的属性访问
        const visit = (node) => {
            // 属性访问: variable.xxx.yyy
            if (ts.isPropertyAccessExpression(node)) {
                const expr = node.expression;
                const propLine = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1;
                // 获取该行的完整代码
                const lineStart = lineStarts[propLine - 1];
                const lineEnd = lineStarts[propLine] || sourceText.length;
                const lineContext = sourceText.slice(lineStart, lineEnd).trim();
                // 检查是否是标识符
                if (ts.isIdentifier(expr)) {
                    if (expr.text === variableName) {
                        // 构建属性访问链
                        const chain = this.buildPropertyChain(node);
                        accesses.push({
                            file: sourceFile.fileName,
                            line: propLine,
                            variableName,
                            accessChain: chain,
                            fullExpression: node.getText().slice(0, 80),
                            codeContext: lineContext,
                        });
                    }
                }
                // 检查链式访问: a.b.c 中的 a
                if (ts.isPropertyAccessExpression(expr)) {
                    const baseExpr = this.getBaseIdentifier(expr);
                    if (baseExpr && baseExpr.text === variableName) {
                        const chain = this.buildPropertyChain(node);
                        accesses.push({
                            file: sourceFile.fileName,
                            line: propLine,
                            variableName,
                            accessChain: chain,
                            fullExpression: node.getText().slice(0, 80),
                            codeContext: lineContext,
                        });
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return accesses.filter(a => a.line > ts.getLineAndCharacterOfPosition(sourceFile, afterNode.getStart()).line);
    }
    /**
     * 获取属性访问的基标识符
     */
    getBaseIdentifier(node) {
        let current = node;
        while (ts.isPropertyAccessExpression(current)) {
            current = current.expression;
        }
        return ts.isIdentifier(current) ? current : null;
    }
    /**
     * 构建属性访问链
     */
    buildPropertyChain(node) {
        const chain = [];
        let current = node;
        while (ts.isPropertyAccessExpression(current)) {
            chain.unshift(current.name.text);
            current = current.expression;
        }
        return chain;
    }
    /**
     * 生成报告
     */
    generateReport(analyses) {
        const lines = [];
        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('                 PROPERTY ACCESS ANALYSIS                     ');
        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('');
        if (analyses.length === 0) {
            lines.push('No call sites found.');
            return lines.join('\n');
        }
        for (const analysis of analyses) {
            lines.push(`📍 ${path.basename(analysis.file)}:${analysis.line}`);
            lines.push(`   Call: ${analysis.callExpression}`);
            if (analysis.returnedTo) {
                lines.push(`   → Returns to: ${analysis.returnedTo}`);
            }
            if (analysis.propertyAccesses.length > 0) {
                lines.push('   Properties accessed:');
                for (const access of analysis.propertyAccesses) {
                    lines.push(`     • ${access.accessChain.join('.')}`);
                    lines.push(`       Line ${access.line}: ${access.fullExpression}`);
                }
            }
            lines.push('');
        }
        // 汇总
        const allProperties = analyses.flatMap(a => a.propertyAccesses.map(p => p.accessChain.join('.')));
        const propertyCounts = new Map();
        for (const prop of allProperties) {
            propertyCounts.set(prop, (propertyCounts.get(prop) || 0) + 1);
        }
        lines.push('─── Property Access Summary ────────────────────────────────');
        const sorted = [...propertyCounts.entries()].sort((a, b) => b[1] - a[1]);
        for (const [prop, count] of sorted.slice(0, 10)) {
            lines.push(`   ${prop}: ${count} occurrence(s)`);
        }
        return lines.join('\n');
    }
}
