/**
 * CallStackBuilder - 调用栈视图构建器
 *
 * 从改动点向上追踪，构建完整的调用链视图
 */
import { Project, Node, SyntaxKind } from 'ts-morph';
import * as path from 'path';
export class CallStackBuilder {
    project;
    projectRoot;
    constructor(projectRoot, tsConfigPath) {
        this.projectRoot = projectRoot;
        this.project = new Project({
            tsConfigFilePath: tsConfigPath,
            skipAddingFilesFromTsConfig: true,
        });
    }
    /**
     * 添加源文件到项目
     */
    addSourceFiles(patterns) {
        for (const pattern of patterns) {
            this.project.addSourceFilesAtPaths(pattern);
        }
        // 过滤 node_modules
        const sourceFiles = this.project.getSourceFiles();
        for (const sf of sourceFiles) {
            if (sf.getFilePath().includes('node_modules')) {
                sf.forget();
            }
        }
    }
    /**
     * 构建调用栈视图（从改动点向上追踪到入口）
     */
    buildCallStack(targetSymbol, targetFile) {
        // 找到目标函数的定义
        const definition = this.findSymbolDefinition(targetSymbol, targetFile);
        if (!definition)
            return null;
        const root = {
            name: targetSymbol,
            file: definition.file,
            line: definition.line,
            type: 'function',
            children: [],
        };
        // 递归追踪调用者
        this.traceCallers(root, new Set(), 0, 10);
        // 计算深度
        const depth = this.calculateDepth(root);
        // 构建路径字符串
        const pathStr = this.buildPathString(root);
        return { root, depth, path: pathStr };
    }
    /**
     * 查找符号定义
     */
    findSymbolDefinition(symbolName, inFile) {
        const sourceFile = this.project.getSourceFile(inFile);
        if (!sourceFile)
            return null;
        let result = null;
        sourceFile.forEachDescendant(node => {
            if (Node.isFunctionDeclaration(node)) {
                const func = node;
                if (func.getName() === symbolName) {
                    result = {
                        file: inFile,
                        line: func.getStartLineNumber(),
                        type: 'function',
                    };
                }
            }
            if (Node.isVariableStatement(node)) {
                const varDecl = node.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
                if (varDecl && varDecl.getName() === symbolName) {
                    result = {
                        file: inFile,
                        line: varDecl.getStartLineNumber(),
                        type: 'variable',
                    };
                }
            }
        });
        return result;
    }
    /**
     * 递归追踪调用者
     */
    traceCallers(node, visited, depth, maxDepth) {
        if (depth > maxDepth)
            return;
        // 找所有调用此函数的地方
        const callers = this.findCallers(node.name, node.file);
        for (const caller of callers) {
            const key = `${caller.file}:${caller.line}:${caller.name}`;
            if (visited.has(key))
                continue;
            visited.add(key);
            // 创建调用者节点
            const callerNode = {
                name: caller.name,
                file: caller.file,
                line: caller.line,
                type: caller.type,
                children: [],
                callSite: {
                    line: caller.callLine,
                    expression: caller.callExpression,
                },
            };
            node.children.push(callerNode);
            // 递归追踪调用者的调用者
            this.traceCallers(callerNode, visited, depth + 1, maxDepth);
        }
    }
    /**
     * 查找调用某个函数的所有地方
     */
    findCallers(symbolName, definedInFile) {
        const results = [];
        for (const sourceFile of this.project.getSourceFiles()) {
            const filePath = sourceFile.getFilePath();
            sourceFile.forEachDescendant((node) => {
                // 查找函数定义
                let funcInfo = null;
                if (Node.isFunctionDeclaration(node)) {
                    const func = node;
                    const name = func.getName();
                    if (name) {
                        funcInfo = {
                            name,
                            file: filePath,
                            line: func.getStartLineNumber(),
                            type: 'function',
                        };
                    }
                }
                else if (Node.isArrowFunction(node)) {
                    // 检查是否是某个 const/let 声明的箭头函数
                    const parent = node.getParent();
                    if (parent && Node.isVariableDeclaration(parent)) {
                        const varDecl = parent;
                        const name = varDecl.getName();
                        if (name && !name.startsWith('_')) {
                            funcInfo = {
                                name,
                                file: filePath,
                                line: node.getStartLineNumber(),
                                type: 'arrow',
                            };
                        }
                    }
                }
                else if (Node.isMethodDeclaration(node)) {
                    const method = node;
                    const name = method.getName();
                    funcInfo = {
                        name,
                        file: filePath,
                        line: method.getStartLineNumber(),
                        type: 'method',
                    };
                }
                else if (Node.isPropertyAssignment(node) && Node.isFunctionExpression(node.getInitializer())) {
                    // React 组件: onClick={() => ...}
                    const prop = node;
                    const name = prop.getName();
                    funcInfo = {
                        name: name || 'anonymous',
                        file: filePath,
                        line: node.getStartLineNumber(),
                        type: 'component',
                    };
                }
                // 如果找到了函数定义，检查是否调用了目标符号
                if (funcInfo && funcInfo.name !== symbolName) {
                    const calls = this.findCallsInNode(node, symbolName);
                    for (const call of calls) {
                        results.push({
                            ...funcInfo,
                            callLine: call.line,
                            callExpression: call.expression,
                        });
                    }
                }
            });
        }
        return results;
    }
    /**
     * 在节点内查找对某个符号的调用
     */
    findCallsInNode(node, symbolName) {
        const results = [];
        node.forEachDescendant((child) => {
            if (Node.isCallExpression(child)) {
                const callExpr = child;
                const expr = callExpr.getExpression();
                if (Node.isIdentifier(expr)) {
                    const name = expr.getText();
                    if (name === symbolName) {
                        results.push({
                            line: callExpr.getStartLineNumber(),
                            expression: callExpr.getText().slice(0, 50),
                        });
                    }
                }
            }
        });
        return results;
    }
    /**
     * 计算树深度
     */
    calculateDepth(node) {
        if (node.children.length === 0)
            return 0;
        return 1 + Math.max(...node.children.map(c => this.calculateDepth(c)));
    }
    /**
     * 构建路径字符串
     */
    buildPathString(node) {
        const result = [];
        const build = (n) => {
            result.push(`${path.basename(n.file)}:${n.line} (${n.name})`);
            if (n.children.length > 0) {
                build(n.children[0]);
            }
        };
        build(node);
        return result;
    }
    /**
     * 生成文本格式的调用栈视图
     */
    formatAsText(tree, changedSymbol) {
        const lines = [];
        lines.push('');
        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('                    📞 调用栈视图 (Call Stack)                  ');
        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('');
        const renderNode = (n, prefix, isLast, isRoot) => {
            const connector = isLast ? '└─' : '├─';
            const current = isRoot
                ? `📍 ${n.name} (改动点)`
                : `${connector} ${n.name}`;
            lines.push(`${prefix}${current} → ${path.basename(n.file)}:${n.line}`);
            if (n.callSite) {
                lines.push(`${prefix}  │`);
                lines.push(`${prefix}  └── 调用: 第${n.callSite.line}行 "${n.callSite.expression}"`);
            }
            const childPrefix = prefix + (isLast ? '   ' : '│  ');
            n.children.forEach((child, idx) => {
                const isChildLast = idx === n.children.length - 1;
                renderNode(child, childPrefix, isChildLast, false);
            });
        };
        renderNode(tree.root, '', true, true);
        lines.push('');
        lines.push(`深度: ${tree.depth} 层`);
        lines.push(`路径: ${tree.path.join(' → ')}`);
        lines.push('');
        return lines.join('\n');
    }
}
