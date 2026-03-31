/**
 * BlastRadiusAnalyzer - 改动影响范围分析器
 *
 * 核心功能：
 * 1. 接收代码改动信息
 * 2. 在依赖图上追溯影响范围
 * 3. 评估风险等级
 * 4. 生成详细的影响报告
 */
import { DependencyGraphBuilder } from './DependencyGraph.js';
export class BlastRadiusAnalyzer {
    config;
    graph = null;
    constructor(config) {
        this.config = config;
    }
    /**
     * 初始化：构建项目依赖图
     */
    async initialize() {
        const builder = new DependencyGraphBuilder(this.config.projectRoot, this.config.tsConfigPath);
        builder.discoverSourceFiles(this.config.includeTests);
        this.graph = builder.build();
        if (this.config.verbose) {
            console.log(`[BlastRadius] Graph built: ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges`);
            console.log(`[BlastRadius] Entry points: ${this.graph.entryPoints.join(', ')}`);
        }
    }
    /**
     * 分析单个改动的爆炸半径
     */
    analyzeChange(change) {
        if (!this.graph) {
            throw new Error('Analyzer not initialized. Call initialize() first.');
        }
        const startTime = Date.now();
        // 1. 找到改动节点
        const changedNodes = this.findChangedNodes(change);
        if (changedNodes.length === 0) {
            return this.createEmptyScope(change);
        }
        // 2. BFS/DFS 追溯影响范围
        const affectedNodes = this.traceImpact(changedNodes, change.type);
        // 3. 统计信息
        const stats = this.computeStats(affectedNodes, changedNodes);
        // 4. 按层级分组
        const levels = this.groupByDepth(affectedNodes, changedNodes);
        // 5. 详细的受影响文件
        const affectedFiles = this.computeAffectedFiles(affectedNodes, change);
        // 6. 传播路径
        const propagationPaths = this.computePropagationPaths(changedNodes, affectedNodes);
        // 7. 高风险影响
        const highRiskImpacts = this.identifyHighRiskImpacts(affectedNodes, change);
        // 8. 建议
        const recommendations = this.generateRecommendations(affectedNodes, change, stats);
        return {
            changedFile: change.file,
            timestamp: new Date().toISOString(),
            stats,
            levels,
            affectedFiles,
            propagationPaths,
            highRiskImpacts,
            recommendations,
        };
    }
    /**
     * 分析多个改动的综合影响
     */
    analyzeChanges(changes) {
        return changes.map((change) => this.analyzeChange(change));
    }
    /**
     * 合并多个 ImpactScope 的综合影响
     */
    mergeImpacts(scopes) {
        if (scopes.length === 0) {
            throw new Error('No scopes to merge');
        }
        const allAffectedFiles = new Map();
        const allHighRisk = [];
        const allPaths = [];
        for (const scope of scopes) {
            // 合并 affectedFiles
            for (const af of scope.affectedFiles) {
                const existing = allAffectedFiles.get(af.file);
                if (!existing || af.impactLevel < existing.impactLevel) {
                    allAffectedFiles.set(af.file, af);
                }
            }
            // 合并高风险
            allHighRisk.push(...scope.highRiskImpacts);
            // 合并路径
            allPaths.push(...scope.propagationPaths);
        }
        // 计算合并后的统计
        const uniqueFiles = new Set(allAffectedFiles.values());
        const stats = {
            totalAffectedFiles: uniqueFiles.size,
            directDependencies: scopes.reduce((s, sc) => s + sc.stats.directDependencies, 0),
            transitiveDependencies: scopes.reduce((s, sc) => s + sc.stats.transitiveDependencies, 0),
            filesWithBreakingChanges: scopes.reduce((s, sc) => s + sc.stats.filesWithBreakingChanges, 0),
            criticalFiles: scopes.reduce((s, sc) => s + sc.stats.criticalFiles, 0),
            estimatedRippleDepth: Math.max(...scopes.map((s) => s.stats.estimatedRippleDepth)),
        };
        return {
            changedFile: 'MULTI',
            timestamp: new Date().toISOString(),
            stats,
            levels: [],
            affectedFiles: Array.from(allAffectedFiles.values()),
            propagationPaths: allPaths,
            highRiskImpacts: allHighRisk,
            recommendations: this.deduplicateRecommendations(scopes.flatMap((s) => s.recommendations)),
        };
    }
    // ─── 私有方法 ───────────────────────────────────────────────────────────────
    /**
     * 找到改动对应的节点
     */
    findChangedNodes(change) {
        const nodes = [];
        // 1. 精确匹配文件路径
        const fileNode = this.graph.nodes.get(change.file);
        if (fileNode) {
            nodes.push(fileNode);
        }
        // 2. 如果有符号名，尝试符号级别匹配
        if (change.symbol) {
            const symbolId = `${change.file}#${change.symbol}`;
            const symbolNode = this.graph.nodes.get(symbolId);
            if (symbolNode) {
                nodes.push(symbolNode);
            }
        }
        // 注意: 不要在这里查找 dependents，traceImpact 会通过 BFS 发现它们
        return nodes;
    }
    /**
     * 追溯影响范围 (BFS)
     */
    traceImpact(startNodes, changeType) {
        const affected = new Map();
        const queue = startNodes.map((n) => ({
            node: n,
            depth: 0,
            path: [n.id],
            edgeTypes: [],
        }));
        const visited = new Set();
        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current.node.id))
                continue;
            visited.add(current.node.id);
            // 记录受影响的节点
            if (!affected.has(current.node.id)) {
                affected.set(current.node.id, {
                    node: current.node,
                    depth: current.depth,
                    path: current.path,
                    edgeTypes: current.edgeTypes,
                });
            }
            // 达到最大深度停止
            if (current.depth >= this.config.maxDepth)
                continue;
            // BFS: 查找所有依赖此节点的节点 (即会受影响的节点)
            // 注意: dependents 是反向索引 - 如果 A imports B, 则 B.dependents 包含 A
            // 当我们从 B 遍历到 A 时，边方向是 A -> B, 所以要反向查找边
            for (const dependentId of current.node.dependents) {
                const dependentNode = this.graph.nodes.get(dependentId);
                if (!dependentNode || visited.has(dependentId))
                    continue;
                // 查找连接边 (反向: dependent -> current.node)
                const edge = this.findEdge(dependentId, current.node.id);
                if (!edge)
                    continue;
                queue.push({
                    node: dependentNode,
                    depth: current.depth + 1,
                    path: [...current.path, dependentId],
                    edgeTypes: [...current.edgeTypes, edge.type],
                });
            }
        }
        return affected;
    }
    /**
     * 查找连接两节点的边
     */
    findEdge(from, to) {
        return this.graph.edges.find((e) => e.from === from && e.to === to);
    }
    /**
     * 计算统计信息
     */
    computeStats(affected, changedNodes) {
        const changedFiles = new Set(changedNodes.map((n) => n.file || n.id));
        const criticalPatterns = this.config.criticalPatterns;
        let criticalFiles = 0;
        let directDeps = 0;
        let transitiveDeps = 0;
        for (const { node, depth } of affected.values()) {
            const file = node.file || node.id;
            // 检查是否关键文件
            if (criticalPatterns.some((p) => this.matchPattern(file, p))) {
                criticalFiles++;
            }
            // 区分直接和传递依赖
            if (depth === 1) {
                directDeps++;
            }
            else if (depth > 1) {
                transitiveDeps++;
            }
        }
        return {
            totalAffectedFiles: affected.size,
            directDependencies: directDeps,
            transitiveDependencies: transitiveDeps,
            filesWithBreakingChanges: this.estimateBreakingChanges(affected),
            criticalFiles,
            estimatedRippleDepth: Math.max(...Array.from(affected.values()).map((a) => a.depth), 0),
        };
    }
    /**
     * 按深度分组
     */
    groupByDepth(affected, changedNodes) {
        const byDepth = new Map();
        // 添加改动节点本身 (depth = 0)
        byDepth.set(0, changedNodes);
        // 分组
        for (const { node, depth } of affected.values()) {
            if (!byDepth.has(depth)) {
                byDepth.set(depth, []);
            }
            byDepth.get(depth).push(node);
        }
        const levels = [];
        const depthDescriptions = {
            0: '直接改动',
            1: '直接依赖',
            2: '二级传递依赖',
            3: '三级传递依赖',
            4: '深层传递依赖',
        };
        for (const [depth, nodes] of byDepth.entries()) {
            levels.push({
                depth,
                description: depthDescriptions[depth] || `深度 ${depth}`,
                files: nodes.map((n) => n.file || n.id).filter(Boolean),
                nodeCount: nodes.length,
            });
        }
        return levels.sort((a, b) => a.depth - b.depth);
    }
    /**
     * 计算详细的受影响文件
     */
    computeAffectedFiles(affected, change) {
        const affectedFiles = [];
        for (const [nodeId, { node, depth, edgeTypes }] of affected.entries()) {
            if (nodeId === change.file)
                continue; // 跳过改动文件本身
            const file = node.file || nodeId;
            // 计算影响因子
            const impactFactors = [];
            // 1. 边的类型
            for (const edgeType of edgeTypes) {
                const factor = this.evaluateEdgeType(edgeType, depth);
                if (factor) {
                    impactFactors.push(factor);
                }
            }
            // 2. 文件类型
            if (file.includes('/components/') || file.includes('/Components/')) {
                impactFactors.push({
                    factor: 'ui-component',
                    weight: 0.6,
                    reason: 'UI 组件变更可能影响多个页面',
                });
            }
            if (file.includes('/api/') || file.includes('/Api/')) {
                impactFactors.push({
                    factor: 'api-layer',
                    weight: 0.8,
                    reason: 'API 层变更影响所有调用方',
                });
            }
            if (file.includes('/hooks/') || file.includes('/utils/')) {
                impactFactors.push({
                    factor: 'shared-utility',
                    weight: 0.9,
                    reason: '共享工具/Hook 被多处引用',
                });
            }
            // 3. 入口文件
            if (this.graph.entryPoints.includes(file)) {
                impactFactors.push({
                    factor: 'entry-point',
                    weight: 1.0,
                    reason: '应用入口文件，影响整个应用',
                });
            }
            affectedFiles.push({
                file,
                kind: node.kind,
                changeType: change.type,
                impactLevel: depth,
                impactFactors,
                line: node.line,
            });
        }
        return affectedFiles.sort((a, b) => a.impactLevel - b.impactLevel);
    }
    /**
     * 评估边类型的影响
     */
    evaluateEdgeType(edgeType, depth) {
        const weights = {
            import: { weight: 0.7, reason: '模块导入依赖' },
            extend: { weight: 0.9, reason: '类继承，可能有覆写' },
            implement: { weight: 0.9, reason: '接口实现，必须兼容' },
            'type-ref': { weight: 0.8, reason: '类型引用，需保持兼容' },
            call: { weight: 0.6, reason: '函数调用，可能有副作用' },
            'property-access': { weight: 0.4, reason: '属性访问，影响较轻' },
            'param-type': { weight: 0.7, reason: '参数类型约束' },
        };
        const info = weights[edgeType];
        if (!info)
            return null;
        return {
            factor: edgeType,
            weight: info.weight * (1 - depth * 0.1), // 深度越大，权重递减
            reason: info.reason,
        };
    }
    /**
     * 计算传播路径
     */
    computePropagationPaths(startNodes, affected) {
        const paths = [];
        for (const [nodeId, { path, edgeTypes, depth }] of affected.entries()) {
            if (path.length < 2)
                continue;
            paths.push({
                from: path[0],
                to: path[path.length - 1],
                path,
                edgeTypes,
                riskLevel: this.calculateRiskLevel(depth, edgeTypes),
            });
        }
        return paths.sort((a, b) => {
            const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
        });
    }
    /**
     * 计算风险等级
     */
    calculateRiskLevel(depth, edgeTypes) {
        if (depth === 0)
            return 'critical';
        // 关键边类型
        const criticalTypes = ['extend', 'implement', 'type-ref', 'call'];
        const hasCritical = edgeTypes.some((t) => criticalTypes.includes(t));
        if (hasCritical && depth <= 1)
            return 'high';
        if (depth <= 2)
            return 'medium';
        return 'low';
    }
    /**
     * 识别高风险影响
     */
    identifyHighRiskImpacts(affected, change) {
        const highRisks = [];
        for (const [nodeId, { depth, edgeTypes }] of affected.entries()) {
            const riskLevel = this.calculateRiskLevel(depth, edgeTypes);
            if (riskLevel === 'critical' || riskLevel === 'high') {
                const node = affected.get(nodeId).node;
                const file = node.file || nodeId;
                highRisks.push({
                    file,
                    reason: this.explainRisk(file, depth, edgeTypes),
                    riskLevel,
                    mitigation: this.suggestMitigation(file, edgeTypes),
                });
            }
        }
        return highRisks.sort((a, b) => {
            const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
        });
    }
    /**
     * 解释风险
     */
    explainRisk(file, depth, edgeTypes) {
        const typeStr = edgeTypes.join(', ');
        if (depth === 0) {
            return `${file} 是直接改动的文件`;
        }
        return `${file} 通过 [${typeStr}] 依赖链受到影响，深度 ${depth}`;
    }
    /**
     * 建议缓解措施
     */
    suggestMitigation(file, edgeTypes) {
        if (edgeTypes.includes('extend')) {
            return '确保子类覆写方法时保持兼容性，考虑使用模板方法模式';
        }
        if (edgeTypes.includes('implement')) {
            return '新增接口方法时提供默认实现，避免破坏现有实现';
        }
        if (edgeTypes.includes('type-ref')) {
            return '类型变更需注意向后兼容，考虑使用联合类型或泛型';
        }
        if (edgeTypes.includes('call')) {
            return '函数改动注意副作用，建议添加参数校验和错误处理';
        }
        return '建议进行全面的回归测试';
    }
    /**
     * 估算破坏性变更数量
     */
    estimateBreakingChanges(affected) {
        let count = 0;
        for (const { node, depth } of affected.values()) {
            // 破坏性变更的可能性评估
            const isBreaking = (node.kind === 'interface' || node.kind === 'type') && depth <= 2 ||
                node.kind === 'function' && depth === 1 ||
                this.graph.entryPoints.includes(node.file || '');
            if (isBreaking)
                count++;
        }
        return count;
    }
    /**
     * 生成建议
     */
    generateRecommendations(affected, change, stats) {
        const recommendations = [];
        // 基于统计的建议
        if (stats.totalAffectedFiles > 20) {
            recommendations.push(`⚠️  影响范围较大 (${stats.totalAffectedFiles} 个文件)，建议分阶段发布`);
        }
        if (stats.criticalFiles > 0) {
            recommendations.push(`🚨  涉及 ${stats.criticalFiles} 个关键文件，需重点测试`);
        }
        if (stats.estimatedRippleDepth > 3) {
            recommendations.push(`📊  影响链深度较深 (${stats.estimatedRippleDepth})，涟漪效应风险较高`);
        }
        // 基于改动类型的建议
        switch (change.type) {
            case 'delete':
                recommendations.push('🗑️  删除操作影响最广，确保无其他代码依赖该模块', '建议使用 IDE 的 "Find Usages" 功能确认无遗漏');
                break;
            case 'rename':
                recommendations.push('✏️  重命名操作需同步更新所有引用', '建议使用 IDE 的重命名重构功能，自动更新所有引用');
                break;
            case 'modify':
                recommendations.push('🔧  修改操作注意保持 API 兼容性', '若需破坏性变更，建议创建新的 API 而非修改现有 API');
                break;
        }
        // 去重
        return this.deduplicateRecommendations(recommendations);
    }
    /**
     * 去重建议
     */
    deduplicateRecommendations(recommendations) {
        return [...new Set(recommendations)];
    }
    /**
     * 简单 glob 模式匹配
     */
    matchPattern(file, pattern) {
        const regex = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*');
        return new RegExp(`^${regex}$`).test(file);
    }
    /**
     * 创建空的影响范围
     */
    createEmptyScope(change) {
        return {
            changedFile: change.file,
            timestamp: new Date().toISOString(),
            stats: {
                totalAffectedFiles: 0,
                directDependencies: 0,
                transitiveDependencies: 0,
                filesWithBreakingChanges: 0,
                criticalFiles: 0,
                estimatedRippleDepth: 0,
            },
            levels: [],
            affectedFiles: [],
            propagationPaths: [],
            highRiskImpacts: [],
            recommendations: ['未找到相关依赖图节点，请确认文件路径正确'],
        };
    }
}
