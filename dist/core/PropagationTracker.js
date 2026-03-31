/**
 * PropagationTracker - 非函数符号的传播追踪器
 *
 * 追踪常量、类型、对象等非函数符号如何传播到下游
 */
import { Project, Node, SyntaxKind, } from 'ts-morph';
export class PropagationTracker {
    project;
    projectRoot;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.project = new Project({
            tsConfigFilePath: `${projectRoot}/tsconfig.json`,
            skipAddingFilesFromTsConfig: true,
        });
        // 添加源文件
        this.project.addSourceFilesAtPaths(`${projectRoot}/**/*.ts`);
    }
    /**
     * 追踪符号的传播路径
     */
    trace(symbolName, filePath, maxDepth = 5) {
        const roots = [];
        const visited = new Set();
        // 1. 首先尝试找到符号定义（顶级声明）
        let definition = this.findDefinition(symbolName, filePath);
        // 2. 如果没找到，尝试作为嵌套属性查找（如 config.api.baseUrl 中的 baseUrl）
        if (!definition) {
            const nestedResult = this.findNestedProperty(symbolName, filePath);
            if (nestedResult) {
                // 追踪父对象的传播
                this.buildPropagationTree(nestedResult.parentObj, filePath, roots, visited, 0, maxDepth, 'object');
                // 添加嵌套属性的引用信息
                for (const ref of nestedResult.references) {
                    const node = {
                        symbol: `${nestedResult.parentObj}.${symbolName}`,
                        file: ref.file,
                        line: ref.line,
                        type: 'nested',
                        children: [],
                        context: ref.context,
                    };
                    roots.push(node);
                }
                return roots;
            }
        }
        if (!definition)
            return [];
        // 构建传播树
        this.buildPropagationTree(symbolName, filePath, roots, visited, 0, maxDepth, definition.type);
        return roots;
    }
    /**
     * 查找嵌套属性（如在对象字面量中定义的属性）
     */
    findNestedProperty(propertyName, filePath) {
        const sourceFile = this.project.getSourceFile(filePath);
        if (!sourceFile)
            return null;
        // 查找所有对象字面量
        const references = [];
        for (const sf of this.project.getSourceFiles()) {
            sf.forEachDescendant(node => {
                // 查找 PropertyAssignment（对象字面量中的属性）
                if (Node.isPropertyAssignment(node)) {
                    const name = node.getName();
                    if (name === propertyName) {
                        // 找到嵌套属性，查找其父对象
                        let parentObj = this.findParentObjectName(node);
                        if (parentObj) {
                            const line = sf.getLineAndColumnAtPos(node.getStart()).line;
                            const lineText = sf.getFullText().split('\n')[line - 1]?.trim() ?? '';
                            references.push({
                                file: sf.getFilePath(),
                                line,
                                context: lineText.slice(0, 80),
                                parentObj,
                            });
                        }
                    }
                }
                // 查找 PropertyAccessExpression（属性访问，如 obj.prop）
                if (Node.isPropertyAccessExpression(node)) {
                    const accessedName = node.getName();
                    if (accessedName === propertyName) {
                        // 检查是否是嵌套属性访问（obj.nested.prop）
                        const expr = node.getExpression();
                        if (Node.isPropertyAccessExpression(expr)) {
                            // 这是嵌套访问，尝试获取完整的路径
                            const fullPath = node.getText();
                            let current = node;
                            let topLevelObj = '';
                            while (current) {
                                if (Node.isIdentifier(current)) {
                                    topLevelObj = current.getText();
                                    break;
                                }
                                if (Node.isPropertyAccessExpression(current)) {
                                    current = current.getExpression();
                                }
                                else {
                                    break;
                                }
                            }
                            if (topLevelObj) {
                                const line = sf.getLineAndColumnAtPos(node.getStart()).line;
                                const lineText = sf.getFullText().split('\n')[line - 1]?.trim() ?? '';
                                references.push({
                                    file: sf.getFilePath(),
                                    line,
                                    context: lineText.slice(0, 80),
                                    parentObj: topLevelObj,
                                });
                            }
                        }
                    }
                }
            });
        }
        if (references.length === 0)
            return null;
        // 返回第一个找到的父对象名
        return {
            definition: { node: references[0], type: 'object' },
            parentObj: references[0].parentObj,
            references: references.map(r => ({ file: r.file, line: r.line, context: r.context })),
        };
    }
    /**
     * 查找对象字面量中属性的父对象名
     */
    findParentObjectName(node) {
        let current = node.getParent();
        while (current) {
            if (Node.isVariableDeclaration(current)) {
                return current.getName();
            }
            if (Node.isPropertyAssignment(current)) {
                // 继续向上找
            }
            if (Node.isObjectLiteralExpression(current)) {
                // 找到了对象字面量，继续向上找变量声明
            }
            current = current.getParent();
        }
        return null;
    }
    /**
     * 查找符号定义
     */
    findDefinition(symbolName, filePath) {
        const sourceFile = this.project.getSourceFile(filePath);
        if (!sourceFile)
            return null;
        let result = null;
        sourceFile.forEachDescendant(node => {
            // 查找 const/let/var 声明
            if (Node.isVariableDeclaration(node)) {
                const name = node.getName();
                if (name === symbolName) {
                    const initializer = node.getInitializer();
                    result = {
                        node,
                        type: 'constant',
                        value: initializer?.getText() ?? undefined,
                    };
                }
            }
            // 查找 type alias
            if (Node.isTypeAliasDeclaration(node)) {
                const name = node.getName();
                if (name === symbolName) {
                    result = { node, type: 'type' };
                }
            }
            // 查找 interface
            if (Node.isInterfaceDeclaration(node)) {
                const name = node.getName();
                if (name === symbolName) {
                    result = { node, type: 'type' };
                }
            }
            // 查找 class
            if (Node.isClassDeclaration(node)) {
                const name = node.getName();
                if (name === symbolName) {
                    result = { node, type: 'object' };
                }
            }
        });
        return result;
    }
    /**
     * 查找符号的所有引用位置
     */
    findReferences(symbolName, filePath) {
        const references = [];
        const sourceFiles = this.project.getSourceFiles();
        for (const sourceFile of sourceFiles) {
            sourceFile.forEachDescendant(node => {
                if (Node.isIdentifier(node)) {
                    if (node.getText() === symbolName) {
                        // 跳过定义位置
                        const parent = node.getParent();
                        if (parent && Node.isVariableDeclaration(parent) && parent.getName() === symbolName) {
                            return;
                        }
                        const file = sourceFile.getFilePath();
                        const line = sourceFile.getLineAndColumnAtPos(node.getStart()).line;
                        const grandParent = node.getParent()?.getParent();
                        references.push({
                            node,
                            file,
                            line,
                            parent: grandParent ?? node.getParent(),
                            context: this.getContextCode(node),
                        });
                    }
                }
            });
        }
        return references;
    }
    /**
     * 获取上下文代码
     */
    getContextCode(node) {
        const sourceFile = node.getSourceFile();
        const start = node.getStart();
        const line = sourceFile.getLineAndColumnAtPos(start).line;
        const lineText = sourceFile.getFullText().split('\n')[line - 1]?.trim() ?? '';
        return lineText.slice(0, 80);
    }
    /**
     * 构建传播树
     */
    buildPropagationTree(symbolName, filePath, roots, visited, depth, maxDepth, symbolType) {
        if (depth > maxDepth)
            return;
        const refs = this.findReferences(symbolName, filePath);
        for (const ref of refs) {
            const key = `${ref.file}:${ref.line}`;
            if (visited.has(key))
                continue;
            visited.add(key);
            const propagationType = this.classifyUsage(ref.node, ref.parent);
            const childNode = {
                symbol: symbolName,
                file: ref.file,
                line: ref.line,
                type: propagationType,
                children: [],
                context: ref.context,
            };
            roots.push(childNode);
            // 如果是变量赋值，追踪赋值的变量
            if (propagationType === 'variable') {
                const assignedVar = this.getAssignedVariable(ref.node, ref.parent);
                if (assignedVar) {
                    this.buildPropagationTree(assignedVar, ref.file, childNode.children, visited, depth + 1, maxDepth, 'variable');
                }
            }
            // 如果是常量传播（如在模板字符串中），追踪该常量所在的函数或赋值
            if (propagationType === 'constant' && ref.parent) {
                // 找到包含这个常量的上下文（如模板表达式、函数参数等）
                this.traceConstantContext(ref.node, ref.file, childNode, visited, depth + 1, maxDepth);
            }
            // 如果是函数参数，追踪函数返回值
            if (propagationType === 'functionArg') {
                const funcName = this.getContainingFunction(ref.node);
                if (funcName) {
                    childNode.type = 'functionArg';
                    // 追踪函数返回值使用
                    this.traceFunctionReturnUsage(funcName, ref.file, childNode, visited, depth + 1, maxDepth);
                }
            }
        }
    }
    /**
     * 分类符号的使用方式
     */
    classifyUsage(node, parent) {
        if (Node.isPropertyAccessExpression(parent)) {
            return 'property';
        }
        if (Node.isTemplateExpression(parent)) {
            return 'constant';
        }
        if (Node.isBinaryExpression(parent)) {
            const op = parent.getOperatorToken().getKind();
            if (op === SyntaxKind.EqualsToken) {
                return 'variable';
            }
            return 'constant';
        }
        if (Node.isVariableDeclaration(parent)) {
            return 'variable';
        }
        if (Node.isPropertyAssignment(parent)) {
            return 'property';
        }
        if (Node.isArrayLiteralExpression(parent)) {
            return 'constant';
        }
        if (Node.isCallExpression(parent)) {
            return 'functionArg';
        }
        if (Node.isReturnStatement(parent?.getParent())) {
            return 'return';
        }
        if (Node.isIfStatement(parent)) {
            return 'constant';
        }
        return 'constant';
    }
    /**
     * 追踪常量使用的上下文（如模板字符串、函数调用等）
     */
    traceConstantContext(node, filePath, parentNode, visited, depth, maxDepth) {
        if (depth > maxDepth)
            return;
        const sourceFile = this.project.getSourceFile(filePath);
        if (!sourceFile)
            return;
        // 向上遍历找到包含的函数或赋值语句
        let current = node.getParent();
        while (current) {
            // 如果是函数声明/表达式
            if (Node.isFunctionDeclaration(current) || Node.isArrowFunction(current)) {
                const funcName = this.getContainingFunction(node);
                if (funcName && funcName !== 'arrow') {
                    parentNode.children.push({
                        symbol: `📥 ${funcName}()`,
                        file: filePath,
                        line: sourceFile.getLineAndColumnAtPos(current.getStart()).line,
                        type: 'functionArg',
                        children: [],
                        context: `Function using constant`,
                    });
                }
                break;
            }
            // 如果是赋值表达式
            if (Node.isBinaryExpression(current)) {
                const op = current.getOperatorToken().getKind();
                if (op === SyntaxKind.EqualsToken) {
                    const left = current.getLeft();
                    if (Node.isIdentifier(left)) {
                        const varName = left.getText();
                        const key = `${filePath}:${varName}:assigned`;
                        if (!visited.has(key)) {
                            visited.add(key);
                            parentNode.children.push({
                                symbol: `📦 ${varName}`,
                                file: filePath,
                                line: sourceFile.getLineAndColumnAtPos(current.getStart()).line,
                                type: 'variable',
                                children: [],
                                context: `Assigned from constant`,
                            });
                            // 递归追踪这个变量
                            this.buildPropagationTree(varName, filePath, parentNode.children, visited, depth + 1, maxDepth, 'variable');
                        }
                    }
                }
                break;
            }
            // 如果是函数调用
            if (Node.isCallExpression(current)) {
                const expr = current.getExpression();
                if (Node.isIdentifier(expr)) {
                    const funcName = expr.getText();
                    parentNode.children.push({
                        symbol: `📥 ${funcName}()`,
                        file: filePath,
                        line: sourceFile.getLineAndColumnAtPos(current.getStart()).line,
                        type: 'functionArg',
                        children: [],
                        context: `Passed to function`,
                    });
                }
                break;
            }
            // 如果是return语句
            if (Node.isReturnStatement(current)) {
                parentNode.children.push({
                    symbol: `📤 return`,
                    file: filePath,
                    line: sourceFile.getLineAndColumnAtPos(current.getStart()).line,
                    type: 'return',
                    children: [],
                    context: `Returned from function`,
                });
                break;
            }
            current = current.getParent();
        }
    }
    /**
     * 获取赋值的变量名
     */
    getAssignedVariable(node, parent) {
        if (Node.isBinaryExpression(parent)) {
            const left = parent.getLeft();
            if (Node.isIdentifier(left)) {
                return left.getText();
            }
        }
        return null;
    }
    /**
     * 获取包含函数名
     */
    getContainingFunction(node) {
        let current = node;
        while (current) {
            if (Node.isFunctionDeclaration(current)) {
                // 检查是否是导出函数
                const parent = current.getParent();
                if (Node.isVariableDeclaration(parent)) {
                    return parent.getName();
                }
                if (Node.isExportDeclaration(current.getParent())) {
                    return current.getName() ?? 'anonymous';
                }
                return current.getName() ?? 'anonymous';
            }
            if (Node.isArrowFunction(current)) {
                const parent = current.getParent();
                if (Node.isVariableDeclaration(parent)) {
                    return parent.getName();
                }
                if (Node.isPropertyAssignment(parent)) {
                    return parent.getName() ?? 'arrow';
                }
                return 'arrow';
            }
            if (Node.isMethodDeclaration(current)) {
                return current.getName() ?? 'method';
            }
            current = current.getParent();
        }
        return null;
    }
    /**
     * 追踪函数返回值的用法
     */
    traceFunctionReturnUsage(funcName, filePath, parentNode, visited, depth, maxDepth) {
        if (depth > maxDepth)
            return;
        const sourceFile = this.project.getSourceFile(filePath);
        if (!sourceFile)
            return;
        sourceFile.forEachDescendant(node => {
            if (Node.isCallExpression(node)) {
                const expr = node.getExpression();
                if (Node.isIdentifier(expr) && expr.getText() === funcName) {
                    const key = `${filePath}:${node.getStartLineNumber()}:return`;
                    if (!visited.has(key)) {
                        visited.add(key);
                        parentNode.children.push({
                            symbol: `${funcName}()`,
                            file: filePath,
                            line: node.getStartLineNumber(),
                            type: 'return',
                            children: [],
                            context: this.getContextCode(node),
                        });
                    }
                }
            }
        });
    }
    /**
     * 格式化传播树为文本
     */
    formatAsText(nodes, indent = '') {
        const lines = [];
        for (const node of nodes) {
            const typeIcon = this.getTypeIcon(node.type);
            lines.push(`${indent}${typeIcon} ${node.symbol} → ${node.file}:${node.line}`);
            lines.push(`${indent}   上下文: ${node.context}`);
            if (node.children.length > 0) {
                lines.push(...this.formatAsText(node.children, indent + '   '));
            }
        }
        return lines.join('\n');
    }
    getTypeIcon(type) {
        switch (type) {
            case 'constant': return '📍';
            case 'variable': return '📦';
            case 'type': return '🏷️';
            case 'object': return '📦';
            case 'property': return '🔗';
            case 'functionArg': return '📥';
            case 'return': return '📤';
            default: return '📍';
        }
    }
}
