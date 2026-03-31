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

import { Project, SyntaxKind, Node, Type, VariableDeclaration, CallExpression, PropertyAccessExpression } from 'ts-morph';
import * as path from 'path';

export interface TypeReference {
  file: string;
  line: number;
  column: number;
  typeName: string;
  usage: 'variable' | 'propertyAccess' | 'functionCall' | 'return' | 'parameter';
  context: string;
  affectedSymbol?: string; // 如 user.name 中的 user
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
    accesses: string[]; // 如 ['total', 'tasks']
  }>;
}

export class TypePropagationAnalyzer {
  private project: Project;
  private projectRoot: string;
  private checker: any;

  constructor(projectRoot: string, tsConfigPath?: string) {
    this.projectRoot = projectRoot;
    this.project = new Project({
      tsConfigFilePath: tsConfigPath ?? `${projectRoot}/tsconfig.json`,
      skipAddingFilesFromTsConfig: true,
    });
    this.project.addSourceFilesAtPaths(`${projectRoot}/src/**/*.ts`);

    const ls = this.project.getLanguageService();
    this.checker = ls.getProgram().getTypeChecker();
  }

  /**
   * 分析函数返回类型的影响
   */
  analyzeFunctionReturnType(functionName: string, inFile: string): TypePropagationResult | null {
    // 找到函数定义
    const sourceFile = this.project.getSourceFile(inFile);
    if (!sourceFile) return null;

    // 尝试找函数
    const functions = sourceFile.getFunctions();
    let targetFunc = null;
    let targetVar: any = null;
    let isVariable = false;

    for (const func of functions) {
      if (func.getName() === functionName) {
        targetFunc = func;
        break;
      }
    }

    // 如果没找到函数，尝试找变量
    if (!targetFunc) {
      const exported = sourceFile.getExportedDeclarations();
      if (exported.has(functionName)) {
        const decls = exported.get(functionName);
        if (decls && decls.length > 0) {
          const decl = decls[0];
          if (decl.getKind() === SyntaxKind.VariableDeclaration) {
            targetVar = decl;
            isVariable = true;
          }
        }
      }
    }

    if (!targetFunc && !targetVar) return null;

    // 获取返回类型
    let returnType: Type;
    let returnTypeText: string;

    if (isVariable && targetVar) {
      // 变量的情况
      const varType = this.checker.getTypeAtLocation(targetVar);
      returnType = varType;
      returnTypeText = varType.getText();
    } else if (targetFunc) {
      // 函数的情况
      const signature = this.checker.getSignatureFromDeclaration(targetFunc);
      if (!signature) return null;
      returnType = signature.getReturnType();
      returnTypeText = returnType.getText();
    } else {
      return null;
    }

    const returnTypeSymbol = returnType.getSymbol();

    console.log(`[TypePropagation] ${functionName} returns: ${returnTypeText}`);

    // 如果返回的是命名类型，找到该类型的定义和使用
    let typeDefinitionFile: string | undefined;
    let typeName = returnTypeText;

    if (returnTypeSymbol) {
      const declarations = returnTypeSymbol.getDeclarations();
      if (declarations.length > 0) {
        typeDefinitionFile = declarations[0].getSourceFile().getFilePath();
        console.log(`[TypePropagation] Type defined at: ${typeDefinitionFile}`);
      }
    }

    // 查找所有使用这个返回类型的地方
    const references = this.findTypeUsages(typeName, returnType);

    // 查找受影响的变量
    const affectedVariables = this.findAffectedVariables(functionName, returnType);

    return {
      functionName,
      file: inFile,
      returnType: returnTypeText,
      typeDefinitionFile,
      references,
      affectedVariables,
    };
  }

  /**
   * 查找类型的使用位置
   */
  private findTypeUsages(typeName: string, returnType: Type): TypeReference[] {
    const refs: TypeReference[] = [];

    // 获取类型的属性
    const typeProperties = returnType.getProperties();
    const propertyNames = typeProperties.map(p => p.getName());

    // 遍历所有源文件
    for (const sourceFile of this.project.getSourceFiles()) {
      const filePath = sourceFile.getFilePath();

      // 跳过 node_modules
      if (filePath.includes('node_modules')) continue;

      sourceFile.forEachDescendant((node: Node) => {
        // 检查类型引用
        if (node.getKind() === SyntaxKind.TypeReference) {
          const typeRefText = node.getText();
          if (typeRefText.includes(typeName) || typeName.includes(typeRefText)) {
            const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart());
            refs.push({
              file: filePath,
              line,
              column,
              typeName,
              usage: 'parameter',
              context: `Type reference: ${typeRefText}`,
            });
          }
        }

        // 检查变量声明
        if (node.getKind() === SyntaxKind.VariableDeclaration) {
          const varNode = node as VariableDeclaration;
          const varName = varNode.getName();
          try {
            const varType = this.checker.getTypeAtLocation(node);
            const varTypeText = varType.getText();
            if (varTypeText.includes(typeName)) {
              const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart());
              refs.push({
                file: filePath,
                line,
                column,
                typeName,
                usage: 'variable',
                context: `Variable ${varName}: ${varTypeText}`,
                affectedSymbol: varName,
              });
            }
          } catch {}
        }
      });
    }

    return refs;
  }

  /**
   * 查找受影响的变量（调用函数并访问其属性的变量）
   */
  private findAffectedVariables(
    functionName: string,
    returnType: Type
  ): Array<{ variableName: string; file: string; line: number; accesses: string[] }> {
    const affected: Array<{ variableName: string; file: string; line: number; accesses: string[] }> = [];

    const returnProperties = returnType.getProperties().map(p => p.getName());

    // 遍历所有源文件找调用点
    for (const sourceFile of this.project.getSourceFiles()) {
      const filePath = sourceFile.getFilePath();
      if (filePath.includes('node_modules')) continue;

      sourceFile.forEachDescendant((node: Node) => {
        // 找函数调用
        if (node.getKind() === SyntaxKind.CallExpression) {
          const callNode = node as CallExpression;
          const callExpr = callNode.getExpression();
          if (callExpr.getText() === functionName) {
            // 找到了调用
            // 检查是否有变量接收返回值
            const parent = node.getParent();
            if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
              const varNode = parent as VariableDeclaration;
              const varName = varNode.getName();

              // 查找这个变量的属性访问
              const accesses: string[] = [];
              const funcBody = sourceFile; // 简化处理

              // 在同一个作用域查找属性访问
              this.findPropertyAccessesOnVariable(sourceFile, varName, returnProperties, accesses);

              if (accesses.length > 0) {
                const { line } = sourceFile.getLineAndColumnAtPos(node.getStart());
                affected.push({
                  variableName: varName,
                  file: filePath,
                  line,
                  accesses,
                });
              }
            }
          }
        }
      });
    }

    return affected;
  }

  /**
   * 查找对变量的属性访问
   */
  private findPropertyAccessesOnVariable(
    sourceFile: any,
    variableName: string,
    returnProperties: string[],
    accesses: string[]
  ): void {
    sourceFile.forEachDescendant((node: Node) => {
      if (node.getKind() === SyntaxKind.PropertyAccessExpression) {
        const propNode = node as PropertyAccessExpression;
        const exprText = propNode.getExpression().getText();
        if (exprText === variableName) {
          const propName = propNode.getName();
          if (returnProperties.includes(propName)) {
            accesses.push(propName);
          }
        }
      }
    });
  }

  /**
   * 生成类型传播报告
   */
  generateReport(result: TypePropagationResult): string {
    const lines: string[] = [];

    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('                   TYPE PROPAGATION ANALYSIS                 ');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`📌 Function: ${result.functionName}`);
    lines.push(`📁 File: ${result.file}`);
    lines.push(`🔤 Return Type: ${result.returnType}`);
    if (result.typeDefinitionFile) {
      lines.push(`📄 Type Defined At: ${result.typeDefinitionFile}`);
    }
    lines.push('');

    if (result.affectedVariables.length > 0) {
      lines.push('─── Affected Variables ──────────────────────────────────────');
      for (const av of result.affectedVariables) {
        lines.push(`  📍 ${av.variableName} (${path.basename(av.file)}:${av.line})`);
        lines.push(`     Accessed properties: ${av.accesses.join(', ')}`);
      }
      lines.push('');
    }

    if (result.references.length > 0) {
      lines.push('─── Type References ─────────────────────────────────────────');
      const byFile = new Map<string, TypeReference[]>();
      for (const ref of result.references) {
        if (!byFile.has(ref.file)) byFile.set(ref.file, []);
        byFile.get(ref.file)!.push(ref);
      }

      for (const [file, refs] of byFile) {
        lines.push(`  📄 ${path.basename(file)}`);
        for (const ref of refs.slice(0, 3)) {
          lines.push(`     • ${ref.usage}: ${ref.context} (line ${ref.line})`);
        }
        if (refs.length > 3) {
          lines.push(`     ... and ${refs.length - 3} more`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
