/**
 * ImpactTracer - 追踪改动的传播路径
 *
 * 基于符号级分析，构建完整的依赖图和影响链
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
  Decorator,
} from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';
import type { AnalyzerConfig } from '../types.js';
import { SymbolAnalyzer, SymbolInfo, ReferenceInfo } from './SymbolAnalyzer.js';
import { PropagationTracker, PropagationNode } from './PropagationTracker.js';

export interface ImpactScope {
  changedFile: string;
  changedSymbol?: string;
  changeType: 'modify' | 'delete' | 'rename' | 'add';
  timestamp: string;

  // 核心信息
  symbolInfo: SymbolInfo | null;

  // 影响统计
  stats: {
    totalAffectedFiles: number;
    directReferences: number;
    indirectReferences: number;
    callSites: number;
    typeReferences: number;
    impactScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  };

  // 受影响的文件
  affectedFiles: AffectedFile[];

  // 传播路径
  propagationPaths: PropagationPath[];

  // 按类型分类
  categorized: {
    definitions: ReferenceInfo[];
    calls: ReferenceInfo[];
    types: ReferenceInfo[];
    exports: ReferenceInfo[];
    extends: ReferenceInfo[];
    implements: ReferenceInfo[];
    properties: ReferenceInfo[];
  };

  // 建议
  recommendations: string[];
}

export interface AffectedFile {
  file: string;
  line: number;
  references: ReferenceInfo[];
  impactFactors: ImpactFactor[];
  category: string;
}

export interface ImpactFactor {
  type: string;
  weight: number;
  description: string;
}

export interface PropagationPath {
  from: string;
  to: string;
  path: string[];
  type: string;
}

export class ImpactTracer {
  private analyzer: SymbolAnalyzer;
  private propagationTracker: PropagationTracker;
  private projectRoot: string;
  private config: AnalyzerConfig;

  constructor(projectRoot: string, tsConfigPath: string, config: AnalyzerConfig) {
    this.projectRoot = projectRoot;
    this.config = config;
    this.analyzer = new SymbolAnalyzer(projectRoot, tsConfigPath);
    this.propagationTracker = new PropagationTracker(projectRoot);
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    this.analyzer.discoverSourceFiles(this.config.includeTests);
  }

  /**
   * 追踪改动影响
   */
  async traceImpact(
    file: string,
    symbol?: string,
    changeType: 'modify' | 'delete' | 'rename' | 'add' = 'modify'
  ): Promise<ImpactScope> {
    // 规范化路径
    const normalizedFile = path.resolve(file);

    // 检查文件是否存在
    if (!fs.existsSync(normalizedFile)) {
      throw new Error(`文件不存在: ${normalizedFile}`);
    }

    // 查找符号
    let symbolInfo: SymbolInfo | null = null;
    let targetSymbol = symbol;

    if (symbol) {
      symbolInfo = this.analyzer.findSymbol(symbol, normalizedFile);
    } else {
      // 尝试从文件名推断主要符号
      symbolInfo = this.inferMainSymbol(normalizedFile);
      if (symbolInfo) {
        targetSymbol = symbolInfo.name;
      }
    }

    // 分析影响 - 如果有符号名，进行全局搜索；否则在文件内搜索
    const analysis = this.analyzer.analyzeImpact(
      targetSymbol || '',
      changeType === 'add' ? 'modify' : changeType,
      targetSymbol ? undefined : normalizedFile  // 有符号名时全局搜索
    );

    // 构建受影响文件列表
    const affectedFiles = this.categorizeAffectedFiles(analysis.references);

    // 生成传播路径
    let propagationPaths = this.buildPropagationPaths(analysis);

    // 使用PropagationTracker获取更详细的传播路径
    // 包括：非函数符号、找不到定义符号的嵌套属性等
    if (symbolInfo) {
      if (symbolInfo.kind !== 'function' && symbolInfo.kind !== 'method') {
        const propNodes = this.propagationTracker.trace(targetSymbol!, normalizedFile);
        if (propNodes.length > 0) {
          // 转换传播节点为PropagationPath格式
          const additionalPaths = this.convertPropagationNodesToPaths(propNodes, symbolInfo.kind);
          propagationPaths = [...propagationPaths, ...additionalPaths];
        }
      }
    } else {
      // symbolInfo 为 null，说明不是顶级符号，可能是嵌套属性
      // 强制调用 PropagationTracker 尝试追踪
      const propNodes = this.propagationTracker.trace(targetSymbol!, normalizedFile);
      if (propNodes.length > 0) {
        const additionalPaths = this.convertPropagationNodesToPaths(propNodes, 'nested');
        propagationPaths = [...propagationPaths, ...additionalPaths];
      }
    }

    // 分类引用
    const categorized = {
      definitions: analysis.references.filter(r => r.referenceType === 'definition'),
      calls: analysis.references.filter(r => r.referenceType === 'call'),
      types: analysis.references.filter(r => r.referenceType === 'type'),
      exports: analysis.references.filter(r => r.referenceType === 'export'),
      extends: analysis.references.filter(r => r.referenceType === 'extend'),
      implements: analysis.references.filter(r => r.referenceType === 'implement'),
      properties: analysis.references.filter(r => r.referenceType === 'property'),
    };

    // 生成建议
    const recommendations = this.generateRecommendations(symbolInfo, analysis, changeType);

    return {
      changedFile: normalizedFile,
      changedSymbol: targetSymbol,
      changeType,
      timestamp: new Date().toISOString(),
      symbolInfo,
      stats: {
        totalAffectedFiles: affectedFiles.length,
        directReferences: analysis.references.filter(r => r.impactLevel === 0).length,
        indirectReferences: analysis.references.filter(r => r.impactLevel > 0).length,
        callSites: analysis.callGraph.size,
        typeReferences: analysis.typeDependencies.length,
        impactScore: analysis.impactScore,
        riskLevel: analysis.riskLevel,
      },
      affectedFiles,
      propagationPaths,
      categorized,
      recommendations,
    };
  }

  /**
   * 从文件名推断主要符号
   */
  private inferMainSymbol(filePath: string): SymbolInfo | null {
    // 提取文件名作为符号名
    const fileName = path.basename(filePath, path.extname(filePath));

    // 常见模式：index.tsx -> 使用目录名
    if (fileName === 'index') {
      const dirName = path.basename(path.dirname(filePath));
      return this.analyzer.findSymbol(dirName, filePath) ||
        this.analyzer.findMainExport(filePath);
    }

    // 尝试查找同名的导出符号（必须是导出的）
    const symbol = this.analyzer.findSymbol(fileName, filePath);
    if (symbol && symbol.exports.length > 0) return symbol;

    // 如果没找到导出的符号，返回文件的主要导出
    return this.analyzer.findMainExport(filePath);
  }

  /**
   * 分类受影响的文件
   */
  private categorizeAffectedFiles(references: ReferenceInfo[]): AffectedFile[] {
    const fileMap = new Map<string, AffectedFile>();

    for (const ref of references) {
      const file = ref.location.file;
      if (!fileMap.has(file)) {
        fileMap.set(file, {
          file,
          line: ref.location.line,
          references: [],
          impactFactors: [],
          category: this.categorizeFile(file),
        });
      }
      fileMap.get(file)!.references.push(ref);

      // 添加影响因子
      const factors = this.computeImpactFactors(ref);
      fileMap.get(file)!.impactFactors.push(...factors);
    }

    return Array.from(fileMap.values()).sort((a, b) => {
      // 按影响因子权重排序
      const aWeight = a.impactFactors.reduce((s, f) => s + f.weight, 0);
      const bWeight = b.impactFactors.reduce((s, f) => s + f.weight, 0);
      return bWeight - aWeight;
    });
  }

  /**
   * 计算影响因子
   */
  private computeImpactFactors(ref: ReferenceInfo): ImpactFactor[] {
    const factors: ImpactFactor[] = [];

    switch (ref.referenceType) {
      case 'call':
        factors.push({
          type: 'function-call',
          weight: 10,
          description: `调用了 ${ref.symbol.name}()`,
        });
        break;
      case 'type':
        factors.push({
          type: 'type-reference',
          weight: 8,
          description: `使用了类型 ${ref.symbol.name}`,
        });
        break;
      case 'extend':
        factors.push({
          type: 'inheritance',
          weight: 15,
          description: `继承了 ${ref.symbol.name}`,
        });
        break;
      case 'implement':
        factors.push({
          type: 'interface',
          weight: 15,
          description: `实现了接口 ${ref.symbol.name}`,
        });
        break;
      case 'property':
        factors.push({
          type: 'property-access',
          weight: 5,
          description: `访问了属性 ${ref.symbol.name}`,
        });
        break;
      case 'export':
        factors.push({
          type: 'export',
          weight: 20,
          description: `重新导出了 ${ref.symbol.name}`,
        });
        break;
    }

    // 文件类型因子
    if (ref.location.file.includes('/api/')) {
      factors.push({
        type: 'api-layer',
        weight: 12,
        description: 'API 层文件，影响范围大',
      });
    }
    if (ref.location.file.includes('/components/')) {
      factors.push({
        type: 'component',
        weight: 8,
        description: 'UI 组件，可能影响多个页面',
      });
    }
    if (ref.location.file.includes('/pages/') || ref.location.file.includes('/views/')) {
      factors.push({
        type: 'page',
        weight: 10,
        description: '页面文件，直接影响用户体验',
      });
    }
    if (ref.location.file.includes('/hooks/')) {
      factors.push({
        type: 'hook',
        weight: 15,
        description: '共享 Hook，影响多个组件',
      });
    }
    if (ref.location.file.includes('/utils/')) {
      factors.push({
        type: 'utility',
        weight: 18,
        description: '工具函数，被广泛引用',
      });
    }
    if (ref.location.file.includes('/store/') || ref.location.file.includes('/redux') || ref.location.file.includes('/mobx')) {
      factors.push({
        type: 'state',
        weight: 25,
        description: '状态管理层，影响整个应用',
      });
    }
    if (ref.location.file.includes('/context') || ref.location.file.includes('/Context')) {
      factors.push({
        type: 'context',
        weight: 22,
        description: 'Context，可能影响多个组件',
      });
    }

    return factors;
  }

  /**
   * 分类文件
   */
  private categorizeFile(filePath: string): string {
    if (filePath.includes('/api/')) return 'API Layer';
    if (filePath.includes('/components/')) return 'Component';
    if (filePath.includes('/pages/') || filePath.includes('/views/')) return 'Page';
    if (filePath.includes('/hooks/')) return 'Hook';
    if (filePath.includes('/utils/')) return 'Utility';
    if (filePath.includes('/store/') || filePath.includes('/redux') || filePath.includes('/mobx')) return 'State Management';
    if (filePath.includes('/context') || filePath.includes('/Context')) return 'Context';
    if (filePath.includes('/types/')) return 'Type Definition';
    if (filePath.includes('/services/')) return 'Service';
    if (filePath.includes('/models/')) return 'Model';
    if (filePath.includes('/middleware/')) return 'Middleware';
    return 'Other';
  }

  /**
   * 将传播节点转换为传播路径
   */
  private convertPropagationNodesToPaths(
    nodes: PropagationNode[],
    symbolKind: string
  ): PropagationPath[] {
    const paths: PropagationPath[] = [];

    // 添加根节点作为路径
    for (const node of nodes) {
      paths.push({
        from: node.symbol,
        to: `${node.file}:${node.line}`,
        path: [node.symbol],
        type: node.type || symbolKind || 'propagate',
      });
      // 递归处理子节点
      const traverseChildren = (children: PropagationNode[], parentSymbol: string) => {
        for (const child of children) {
          paths.push({
            from: parentSymbol,
            to: `${child.file}:${child.line}`,
            path: [parentSymbol, child.symbol],
            type: child.type || symbolKind || 'propagate',
          });
          if (child.children.length > 0) {
            traverseChildren(child.children, child.symbol);
          }
        }
      };
      if (node.children.length > 0) {
        traverseChildren(node.children, node.symbol);
      }
    }

    return paths;
  }

  /**
   * 构建传播路径
   */
  private buildPropagationPaths(analysis: ReturnType<SymbolAnalyzer['analyzeImpact']>): PropagationPath[] {
    const paths: PropagationPath[] = [];

    // 从调用图构建路径
    for (const [funcName, refs] of analysis.callGraph.entries()) {
      for (const ref of refs) {
        paths.push({
          from: `${analysis.symbol?.file}:${analysis.symbol?.name}`,
          to: `${ref.location.file}:${ref.location.line}`,
          path: [analysis.symbol?.name || '', funcName],
          type: 'call',
        });
      }
    }

    // 从类型依赖构建路径
    for (const ref of analysis.typeDependencies) {
      paths.push({
        from: `${analysis.symbol?.file}:${analysis.symbol?.name}`,
        to: `${ref.location.file}:${ref.location.line}`,
        path: [analysis.symbol?.name || '', ref.symbol.name],
        type: 'type',
      });
    }

    return paths;
  }

  /**
   * 生成建议
   */
  private generateRecommendations(
    symbol: SymbolInfo | null,
    analysis: ReturnType<SymbolAnalyzer['analyzeImpact']>,
    changeType: string
  ): string[] {
    const recs: string[] = [];

    // 基于风险等级
    if (analysis.riskLevel === 'critical') {
      recs.push('🚨 极高风险：此改动影响范围极广，建议仔细评估');
    } else if (analysis.riskLevel === 'high') {
      recs.push('⚠️ 高风险：建议进行全面的回归测试');
    }

    // 基于改动类型
    if (changeType === 'delete') {
      recs.push('🗑️ 删除操作影响最大，确保没有遗漏的引用');
      recs.push('💡 建议：先标记为 @deprecated，逐步废弃后再删除');
    }

    if (changeType === 'rename') {
      recs.push('✏️ 重命名操作需要同步更新所有引用');
      recs.push('💡 建议：使用 IDE 的重构功能自动更新');
    }

    // 基于影响分数
    if (analysis.impactScore > 100) {
      recs.push('📊 影响分数较高，建议分阶段发布');
    }

    // 基于符号类型
    if (symbol?.kind === 'interface') {
      recs.push('📝 接口改动风险较高，确保向后兼容');
      recs.push('💡 建议：新增方法时提供默认实现');
    }

    if (symbol?.kind === 'class') {
      recs.push('📝 类改动风险较高，注意继承层次');
      recs.push('💡 建议：检查所有子类是否受影响');
    }

    if (symbol?.kind === 'function') {
      recs.push('📝 函数改动，注意参数兼容性和返回值');
    }

    // 基于调用点数量
    if (analysis.callGraph.size > 10) {
      recs.push(`📞 此函数被 ${analysis.callGraph.size} 个地方调用，影响面广`);
    }

    // 基于类型引用数量
    if (analysis.typeDependencies.length > 5) {
      recs.push(`🔗 此类型被 ${analysis.typeDependencies.length} 个地方引用`);
    }

    // 默认建议
    if (recs.length === 0) {
      recs.push('✅ 影响范围较小，可正常发布');
    }

    return recs;
  }
}
