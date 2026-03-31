/**
 * SymbolAnalyzer - 符号级分析器
 *
 * 使用 ts-morph 的 findReferences() 追踪符号的所有引用
 * 比 import 追踪强大得多
 */

import {
  Project,
  Node,
  SyntaxKind,
  SourceFile,
  CallExpression,
  PropertyAccessExpression,
  VariableDeclaration,
  FunctionDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
} from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

export interface SymbolLocation {
  file: string;
  line: number;
  column: number;
  node: Node;
  nodeKind: string;
  context: string;
}

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum' | 'property' | 'method' | 'parameter' | 'unknown';
  file: string;
  line: number;
  declaration: Node;
  exports: string[];
}

export interface ReferenceInfo {
  symbol: SymbolInfo;
  location: SymbolLocation;
  referenceType: 'definition' | 'import' | 'call' | 'type' | 'assign' | 'property' | 'export' | 'extend' | 'implement' | 'decorate' | 'parameter' | 'generic';
  impactLevel: number;
}

export class SymbolAnalyzer {
  private project: Project;
  private projectRoot: string;
  private cache: Map<string, SymbolInfo[]> = new Map();
  private referenceCache: Map<string, ReferenceInfo[]> = new Map();

  constructor(projectRoot: string, tsConfigPath?: string) {
    this.projectRoot = projectRoot;
    this.project = new Project({
      tsConfigFilePath: tsConfigPath ?? `${projectRoot}/tsconfig.json`,
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * 添加源文件
   */
  addSourceFiles(patterns: string[]): void {
    for (const pattern of patterns) {
      const fullPattern = pattern.startsWith('/')
        ? pattern
        : `${this.projectRoot}/${pattern}`;
      this.project.addSourceFilesAtPaths(fullPattern);
    }
  }

  /**
   * 递归扫描目录获取文件列表
   */
  private scanDirectory(dir: string, extensions: string[], maxDepth: number = 10, currentDepth: number = 0): string[] {
    if (currentDepth > maxDepth) return [];

    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // 跳过 node_modules 和隐藏目录
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          files.push(...this.scanDirectory(fullPath, extensions, maxDepth, currentDepth + 1));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (e) {
      // 忽略无法读取的目录
    }
    return files;
  }

  /**
   * 自动发现并添加所有源文件
   */
  discoverSourceFiles(includeTests = false): void {
    // 大项目保护阈值
    const MAX_FILES = 500;

    const extensions = includeTests
      ? ['.ts', '.tsx', '.js', '.jsx']
      : ['.ts', '.tsx'];

    // 扫描目录获取所有匹配的文件
    const allFiles = this.scanDirectory(this.projectRoot, extensions);

    // 过滤 node_modules（虽然scanDirectory已经跳过，但双重保险）
    const filteredFiles = allFiles.filter(f => !f.includes('node_modules'));

    // 如果文件数量超过阈值，优先保留非测试文件
    if (filteredFiles.length > MAX_FILES) {
      console.warn(`⚠️ 警告: 检测到 ${filteredFiles.length} 个源文件（超过 ${MAX_FILES} 限制）`);

      if (includeTests) {
        console.warn('   策略: 优先保留源代码文件，限制测试文件数量');
      } else {
        console.warn(`   策略: 限制总文件数量为 ${MAX_FILES}`);
      }
    }

    // 按优先级排序：源代码 > 测试代码
    const sorted = filteredFiles.sort((a, b) => {
      if (!includeTests) return 0;
      const aIsTest = a.includes('.test.') || a.includes('.spec.') || a.includes('__tests__');
      const bIsTest = b.includes('.test.') || b.includes('.spec.') || b.includes('__tests__');
      if (aIsTest && !bIsTest) return 1;
      if (!aIsTest && bIsTest) return -1;
      return 0;
    });

    // 限制文件数量
    const limitedFiles = sorted.slice(0, MAX_FILES);

    // 添加文件到项目
    let addedCount = 0;
    for (const file of limitedFiles) {
      try {
        this.project.addSourceFileAtPath(file);
        addedCount++;
      } catch (e) {
        // 忽略添加失败的文件
      }
    }

    console.log(`   已加载 ${addedCount} 个源文件`);
  }

  /**
   * 获取项目
   */
  getProject(): Project {
    return this.project;
  }

  /**
   * 获取所有源文件
   */
  getSourceFiles(): SourceFile[] {
    return this.project.getSourceFiles();
  }

  /**
   * 查找文件的主要导出符号
   * 返回默认导出或第一个命名导出
   */
  findMainExport(filePath: string): SymbolInfo | null {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return null;

    // 获取所有导出声明
    const exported = sourceFile.getExportedDeclarations();
    if (exported.size === 0) return null;

    // 优先查找 default 导出
    if (exported.has('default')) {
      const decls = exported.get('default')!;
      if (decls.length > 0) {
        const decl = decls[0];
        return this.createSymbolInfo('default', this.getNodeKind(decl), decl);
      }
    }

    // 否则返回第一个导出
    const firstEntry = exported.entries().next().value;
    if (firstEntry) {
      const [name, decls] = firstEntry;
      if (decls.length > 0) {
        return this.createSymbolInfo(name, this.getNodeKind(decls[0]), decls[0]);
      }
    }

    return null;
  }

  /**
   * 获取节点对应的符号类型
   */
  private getNodeKind(node: Node): SymbolInfo['kind'] {
    const kind = node.getKind();
    switch (kind) {
      case SyntaxKind.FunctionDeclaration: return 'function';
      case SyntaxKind.ClassDeclaration: return 'class';
      case SyntaxKind.InterfaceDeclaration: return 'interface';
      case SyntaxKind.TypeAliasDeclaration: return 'type';
      case SyntaxKind.VariableDeclaration: return 'variable';
      case SyntaxKind.EnumDeclaration: return 'enum';
      default: return 'unknown';
    }
  }

  /**
   * 查找符号信息
   */
  findSymbol(symbolName: string, inFile?: string): SymbolInfo | null {
    const sourceFiles = inFile
      ? [this.project.getSourceFile(inFile)].filter(Boolean) as SourceFile[]
      : this.project.getSourceFiles();

    for (const sourceFile of sourceFiles) {
      // 查找函数
      const funcs = sourceFile.getFunctions();
      for (const func of funcs) {
        const name = func.getName();
        if (name && name === symbolName) {
          return this.createSymbolInfo(name, 'function', func);
        }
      }

      // 查找类
      const classes = sourceFile.getClasses();
      for (const cls of classes) {
        const name = cls.getName();
        if (name && name === symbolName) {
          return this.createSymbolInfo(name, 'class', cls);
        }
        // 检查静态属性和方法
        for (const prop of cls.getStaticProperties()) {
          const propName = prop.getName();
          if (propName && propName === symbolName) {
            return this.createSymbolInfo(propName, 'property', prop);
          }
        }
        for (const method of cls.getStaticMethods()) {
          const methodName = method.getName();
          if (methodName && methodName === symbolName) {
            return this.createSymbolInfo(methodName, 'method', method);
          }
        }
      }

      // 查找接口
      const interfaces = sourceFile.getInterfaces();
      for (const int of interfaces) {
        const name = int.getName();
        if (name && name === symbolName) {
          return this.createSymbolInfo(name, 'interface', int);
        }
      }

      // 查找类型别名
      const types = sourceFile.getTypeAliases();
      for (const type of types) {
        const name = type.getName();
        if (name && name === symbolName) {
          return this.createSymbolInfo(name, 'type', type);
        }
      }

      // 查找变量
      const vars = sourceFile.getVariableDeclarations();
      for (const v of vars) {
        const name = v.getName();
        if (name && name === symbolName) {
          return this.createSymbolInfo(name, 'variable', v);
        }
      }
    }

    return null;
  }

  /**
   * 查找符号的所有引用
   * 使用 TypeScript Language Service 的 findReferences API 实现真正的符号级追踪
   */
  findAllReferences(symbolName: string, inFile?: string): ReferenceInfo[] {
    const cacheKey = `${inFile ?? 'global'}:${symbolName}`;
    if (this.referenceCache.has(cacheKey)) {
      return this.referenceCache.get(cacheKey)!;
    }

    const references: ReferenceInfo[] = [];

    // 先找到符号定义
    const symbolInfo = this.findSymbol(symbolName, inFile);
    if (!symbolInfo) {
      return [];
    }

    // 找到声明节点
    const declarationNode = symbolInfo.declaration;

    // 使用 Language Service 的 findReferences（传入 Node，不是位置）
    const languageService = this.project.getLanguageService();

    try {
      const refs = languageService.findReferences(declarationNode);

      for (const refSymbol of refs || []) {
        const nodeRefs = refSymbol.getReferences();

        for (const entry of nodeRefs || []) {
          const compilerObj = entry.compilerObject;
          const filePath = compilerObj.fileName;

          // 跳过 node_modules
          if (filePath.includes('node_modules')) {
            continue;
          }

          // 获取源文件计算行号
          const sourceFile = this.project.getSourceFile(filePath);
          if (!sourceFile) {
            continue;
          }

          const startPos = compilerObj.textSpan.start;
          const { line, column } = sourceFile.getLineAndColumnAtPos(startPos);

          // 获取标识符文本
          const node = sourceFile.getDescendantAtPos(startPos);

          references.push({
            symbol: symbolInfo,
            location: {
              file: filePath,
              line,
              column,
              node: node || sourceFile,
              nodeKind: node?.getKindName() || 'Unknown',
              context: compilerObj.isDefinition ? 'Definition' : compilerObj.isWriteAccess ? 'Write' : 'Read',
            },
            referenceType: compilerObj.isDefinition ? 'definition' : this.classifyReferenceByNode(node),
            impactLevel: 0,
          });
        }
      }
    } catch (error) {
      // 如果 findReferences 失败，回退到遍历方式
      console.warn('findReferences failed, falling back to text search:', error);
      return this.findAllReferencesFallback(symbolName, inFile, symbolInfo);
    }

    // 去重
    const unique = this.deduplicateReferences(references);
    this.referenceCache.set(cacheKey, unique);
    return unique;
  }

  /**
   * 回退方案：使用文本匹配查找引用
   */
  private findAllReferencesFallback(symbolName: string, inFile: string | undefined, symbolInfo: SymbolInfo): ReferenceInfo[] {
    const references: ReferenceInfo[] = [];

    const sourceFiles = inFile
      ? [this.project.getSourceFile(inFile)].filter(Boolean) as SourceFile[]
      : this.project.getSourceFiles();

    for (const sourceFile of sourceFiles) {
      sourceFile.forEachDescendant((node: Node) => {
        if (node.getKind() !== SyntaxKind.Identifier) return;
        if (node.getText() !== symbolName) return;
        if (symbolInfo && node.getStart() === symbolInfo.declaration.getStart()) return;

        const startPos = node.getStart();
        const { line, column } = sourceFile.getLineAndColumnAtPos(startPos);

        references.push({
          symbol: symbolInfo,
          location: {
            file: sourceFile.getFilePath(),
            line,
            column,
            node,
            nodeKind: SyntaxKind[node.getKind()],
            context: this.getNodeContext(node),
          },
          referenceType: this.classifyReference(node, symbolName),
          impactLevel: 0,
        });
      });
    }

    return references;
  }

  /**
   * 根据节点分类引用类型
   */
  private classifyReferenceByNode(node: Node | undefined): ReferenceInfo['referenceType'] {
    if (!node) return 'import';

    const parent = node.getParent();
    if (!parent) return 'import';

    switch (parent.getKind()) {
      case SyntaxKind.CallExpression:
        return 'call';
      case SyntaxKind.TypeReference:
        return 'type';
      case SyntaxKind.PropertyAccessExpression:
        return 'property';
      case SyntaxKind.ExportAssignment:
        return 'export';
      default:
        return 'import';
    }
  }

  /**
   * 分类引用类型
   */
  private classifyReference(node: Node, symbolName: string): ReferenceInfo['referenceType'] {
    const parent = node.getParent();

    if (parent?.getKind() === SyntaxKind.CallExpression) {
      if ((parent as CallExpression).getExpression() === node) {
        return 'call';
      }
    }

    if (parent?.getKind() === SyntaxKind.TypeReference) {
      return 'type';
    }

    if (parent?.getKind() === SyntaxKind.PropertyAccessExpression) {
      return 'property';
    }

    if (parent?.getKind() === SyntaxKind.ExportAssignment) {
      return 'export';
    }

    if (parent?.getKind() === SyntaxKind.HeritageClause) {
      const parentParent = parent.getParent();
      if (parentParent?.getKind() === SyntaxKind.ClassDeclaration) {
        return 'extend';
      }
      if (parentParent?.getKind() === SyntaxKind.InterfaceDeclaration) {
        return 'extend';
      }
    }

    if (parent?.getKind() === SyntaxKind.PropertyDeclaration) {
      return 'property';
    }

    if (node.getKind() === SyntaxKind.FunctionDeclaration) {
      return 'definition';
    }

    if (node.getKind() === SyntaxKind.ClassDeclaration) {
      return 'definition';
    }

    if (node.getKind() === SyntaxKind.InterfaceDeclaration) {
      return 'definition';
    }

    if (node.getKind() === SyntaxKind.TypeAliasDeclaration) {
      return 'definition';
    }

    if (node.getKind() === SyntaxKind.VariableDeclaration) {
      return 'assign';
    }

    return 'import';
  }

  /**
   * 获取节点上下文描述
   */
  private getNodeContext(node: Node): string {
    const text = node.getText().slice(0, 50);
    const parent = node.getParent();

    if (parent?.getKind() === SyntaxKind.CallExpression) {
      const call = parent as CallExpression;
      if (call.getExpression() === node) {
        return `Called as ${text}(...)`;
      }
      return `Passed to ${call.getExpression().getText()}(${text})`;
    }

    if (parent?.getKind() === SyntaxKind.PropertyAccessExpression) {
      return `Accessed as ${text}`;
    }

    if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
      return `Assigned to variable ${(parent as VariableDeclaration).getName()}`;
    }

    if (parent?.getKind() === SyntaxKind.TypeReference) {
      return `Used as type ${text}`;
    }

    return text;
  }

  /**
   * 创建符号信息
   */
  private createSymbolInfo(name: string, kind: SymbolInfo['kind'], node: Node): SymbolInfo {
    const sourceFile = node.getSourceFile();
    const startPos = node.getStart();
    const { line, column } = sourceFile.getLineAndColumnAtPos(startPos);

    const exports: string[] = [];
    if (sourceFile.getExportedDeclarations().has(name)) {
      exports.push(name);
    }

    return {
      name,
      kind,
      file: sourceFile.getFilePath(),
      line,
      declaration: node,
      exports,
    };
  }

  /**
   * 去重引用
   */
  private deduplicateReferences(refs: ReferenceInfo[]): ReferenceInfo[] {
    const seen = new Set<string>();
    return refs.filter((ref) => {
      const key = `${ref.location.file}:${ref.location.line}:${ref.location.column}:${ref.symbol.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 分析改动的影响范围（递归深度分析）
   */
  analyzeImpact(symbolName: string, changeType: 'modify' | 'delete' | 'rename' = 'modify', inFile?: string, maxDepth: number = 10): {
    symbol: SymbolInfo | null;
    references: ReferenceInfo[];
    callGraph: Map<string, ReferenceInfo[]>;
    typeDependencies: ReferenceInfo[];
    exportDependents: ReferenceInfo[];
    downstreamChain: DownstreamNode[];
    impactScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  } {
    const symbol = this.findSymbol(symbolName, inFile);

    // 递归收集所有下游依赖
    const allRefs = new Map<string, ReferenceInfo>();
    this.collectDownstreamReferences(symbolName, inFile, allRefs, 0, maxDepth);

    const refs = Array.from(allRefs.values());

    // 分类引用
    const callGraph = new Map<string, ReferenceInfo[]>();
    const typeDependencies: ReferenceInfo[] = [];
    const exportDependents: ReferenceInfo[] = [];

    for (const ref of refs) {
      if (ref.referenceType === 'call') {
        const funcName = ref.symbol.name;
        if (!callGraph.has(funcName)) {
          callGraph.set(funcName, []);
        }
        callGraph.get(funcName)!.push(ref);
      }

      if (ref.referenceType === 'type') {
        typeDependencies.push(ref);
      }

      if (ref.referenceType === 'export') {
        exportDependents.push(ref);
      }
    }

    // 构建下游链路
    const downstreamChain = this.buildDownstreamChain(symbolName, refs);

    // 计算影响分数
    let impactScore = 0;
    impactScore += refs.filter(r => r.referenceType === 'call').length * 10;
    impactScore += refs.filter(r => r.referenceType === 'type').length * 5;
    impactScore += refs.filter(r => r.referenceType === 'extend').length * 15;
    impactScore += refs.filter(r => r.referenceType === 'implement').length * 15;
    impactScore += exportDependents.length * 20;

    // 风险等级
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (symbol?.kind === 'class' || symbol?.kind === 'interface') riskLevel = 'medium';
    if (changeType === 'delete') riskLevel = 'high';
    if (symbol?.kind === 'interface' && changeType === 'delete') riskLevel = 'critical';
    if (impactScore > 100) riskLevel = 'high';
    if (impactScore > 200) riskLevel = 'critical';

    return {
      symbol,
      references: refs,
      callGraph,
      typeDependencies,
      exportDependents,
      downstreamChain,
      impactScore,
      riskLevel,
    };
  }

  /**
   * 下游节点
   */
  private downstreamNodes: Map<string, DownstreamNode> = new Map();

  /**
   * 递归收集下游引用
   */
  private collectDownstreamReferences(
    symbolName: string,
    inFile: string | undefined,
    collected: Map<string, ReferenceInfo>,
    depth: number,
    maxDepth: number
  ): void {
    if (depth > maxDepth) return;

    const refs = this.findAllReferences(symbolName, inFile);

    for (const ref of refs) {
      const key = `${ref.location.file}:${ref.location.line}:${ref.symbol.name}`;
      if (!collected.has(key)) {
        collected.set(key, ref);

        // 如果是调用，继续递归追踪下游
        if (ref.referenceType === 'call' && depth < maxDepth) {
          this.collectDownstreamReferences(
            ref.symbol.name,
            ref.location.file,
            collected,
            depth + 1,
            maxDepth
          );
        }
      }
    }
  }

  /**
   * 构建下游链路
   */
  private buildDownstreamChain(symbolName: string, refs: ReferenceInfo[]): DownstreamNode[] {
    const chain: DownstreamNode[] = [];
    const processedFiles = new Set<string>();

    // 按深度和文件组织
    const levelMap = new Map<number, Map<string, DownstreamNode>>();

    for (const ref of refs) {
      const depth = ref.impactLevel || 0;
      if (!levelMap.has(depth)) {
        levelMap.set(depth, new Map());
      }
      const fileKey = ref.location.file;
      if (!levelMap.get(depth)!.has(fileKey)) {
        levelMap.get(depth)!.set(fileKey, {
          depth,
          file: fileKey,
          fileName: fileKey.split('/').pop() || fileKey,
          type: this.categorizeFile(fileKey),
          callSites: [],
          references: [],
        });
      }
      const node = levelMap.get(depth)!.get(fileKey)!;
      node.references.push(ref);

      if (ref.referenceType === 'call') {
        node.callSites.push({
          line: ref.location.line,
          calledFunction: ref.symbol.name,
          context: ref.location.context,
        });
      }
    }

    // 转换为数组并按深度排序
    const levels = Array.from(levelMap.entries()).sort((a, b) => a[0] - b[0]);
    for (const [depth, files] of levels) {
      chain.push(...Array.from(files.values()));
    }

    return chain;
  }

  /**
   * 分类文件
   */
  private categorizeFile(filePath: string): string {
    if (filePath.includes('/api/')) return 'API Layer';
    if (filePath.includes('/components/')) return 'Component';
    if (filePath.includes('/pages/') || filePath.includes('/views/')) return 'Page';
    if (filePath.includes('/hooks/')) return 'Hook';
    if (filePath.includes('/store/') || filePath.includes('/redux') || filePath.includes('/mobx')) return 'State Management';
    if (filePath.includes('/context') || filePath.includes('/Context')) return 'Context';
    if (filePath.includes('/utils/')) return 'Utility';
    if (filePath.includes('/types/')) return 'Type Definition';
    if (filePath.includes('/services/')) return 'Service';
    return 'Other';
  }
}

export interface DownstreamNode {
  depth: number;
  file: string;
  fileName: string;
  type: string;
  callSites: Array<{
    line: number;
    calledFunction: string;
    context: string;
  }>;
  references: ReferenceInfo[];
}
