#!/usr/bin/env node
/**
 * Blast Radius Analyzer - 改动影响范围分析器
 *
 * 使用符号级分析 + 数据流追踪
 * 支持任意 JavaScript/TypeScript 项目
 *
 * Usage:
 *   blast-radius --project ./src --change src/api/user.ts
 *   blast-radius --project ./src --change src/utils/helper.ts --symbol helperFunc
 *   blast-radius --project ./src --change src/api/task.ts --graph
 */
import * as path from 'path';
import * as fs from 'fs';
import { ImpactTracer } from './core/ImpactTracer.js';
import { AnalysisCache } from './core/AnalysisCache.js';
import { DependencyGraphBuilder } from './core/DependencyGraph.js';
import { PropertyAccessTracker } from './core/PropertyAccessTracker.js';
import { CallStackBuilder } from './core/CallStackBuilder.js';
import { TypeFlowAnalyzer } from './core/TypeFlowAnalyzer.js';
import { DataFlowAnalyzer } from './core/DataFlowAnalyzer.js';
function parseArgs(argv) {
    let projectRoot = process.cwd();
    let tsConfig = '';
    const changes = [];
    let maxDepth = 10;
    let includeTests = false;
    let verbose = false;
    let output = null;
    let format = 'text';
    let useCache = true;
    let clearCache = false;
    let threshold = undefined;
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if ((arg === '--project' || arg === '-p') && argv[i + 1]) {
            projectRoot = path.resolve(argv[++i]);
            tsConfig = `${projectRoot}/tsconfig.json`;
        }
        else if (arg === '--tsconfig' && argv[i + 1]) {
            tsConfig = path.resolve(argv[++i]);
        }
        else if ((arg === '--change' || arg === '-c') && argv[i + 1]) {
            const changePath = path.resolve(projectRoot, argv[++i]);
            changes.push({ file: changePath, type: 'modify' });
        }
        else if (arg === '--symbol' && argv[i + 1]) {
            if (changes.length > 0) {
                changes[changes.length - 1].symbol = argv[++i];
            }
        }
        else if (arg === '--type' && argv[i + 1]) {
            if (changes.length > 0) {
                changes[changes.length - 1].type = argv[++i];
            }
        }
        else if (arg === '--max-depth' && argv[i + 1]) {
            maxDepth = parseInt(argv[++i], 10);
        }
        else if (arg === '--include-tests' || arg === '-t') {
            includeTests = true;
        }
        else if (arg === '--verbose' || arg === '-v') {
            verbose = true;
        }
        else if ((arg === '--output' || arg === '-o') && argv[i + 1]) {
            output = argv[++i];
            if (output.endsWith('.json'))
                format = 'json';
            else if (output.endsWith('.svg'))
                format = 'graph';
            // Don't set format to 'html' if --graph was already set
        }
        else if (arg === '--graph') {
            format = 'graph';
        }
        else if (arg === '--no-cache') {
            useCache = false;
        }
        else if (arg === '--clear-cache') {
            clearCache = true;
        }
        else if (arg === '--threshold' && argv[i + 1]) {
            // 解析阈值: --threshold files:5,score:100,typeErrors:0
            const thresholdStr = argv[++i];
            threshold = {};
            for (const part of thresholdStr.split(',')) {
                const [key, value] = part.split(':');
                const num = parseInt(value, 10);
                if (key === 'files')
                    threshold.files = num;
                else if (key === 'score')
                    threshold.score = num;
                else if (key === 'typeErrors')
                    threshold.typeErrors = num;
            }
        }
        else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }
    }
    // Default to HTML if no format detected and not graph
    if (format === 'text' && output?.endsWith('.html')) {
        format = 'html';
    }
    return {
        projectRoot,
        tsConfig,
        changes,
        maxDepth,
        includeTests,
        verbose,
        output,
        format,
        useCache,
        clearCache,
        threshold: threshold,
    };
}
function printHelp() {
    console.log(`
blast-radius - Code Change Impact Analyzer
==========================================

Usage:
  blast-radius [options]

Options:
  -p, --project <path>        Project root directory (default: cwd)
  --tsconfig <path>           Path to tsconfig.json
  -c, --change <file>         File that changed (can be specified multiple times)
  --symbol <name>             Specific symbol that changed (function/class name)
  --type <type>               Change type: add|modify|delete|rename (default: modify)
  --max-depth <n>             Maximum analysis depth (default: 10)
  -t, --include-tests         Include test files in analysis
  -o, --output <file>         Output file (auto-detect format from extension)
  --format <format>           Output format: json|text|html (default: text)
  --graph                     Generate interactive dependency graph (outputs SVG)
  --no-cache                 Disable incremental analysis cache
  --clear-cache              Clear analysis cache
  --threshold <rules>         CI/CD threshold alert (e.g., files:5,score:100,typeErrors:0)
  -v, --verbose               Verbose output
  -h, --help                  Show this help

CI/CD Examples:
  # Set threshold for auto-fail in CI
  blast-radius -p ./src -c src/api/task.ts --threshold files:5,score:100,typeErrors:0

  # Use with git hooks or CI pipelines
  blast-radius -p ./src -c src/api/task.ts --threshold files:3 -o result.json

Examples:
  # Analyze a single file change
  blast-radius -p ./src -c src/api/user.ts

  # Analyze a specific function change
  blast-radius -p ./src -c src/utils/helper.ts --symbol helperFunc

  # Analyze a delete operation
  blast-radius -p ./src -c src/old/func.ts --type delete

  # Output as JSON
  blast-radius -p ./src -c src/api/task.ts -o result.json

  # Output as HTML with dependency graph
  blast-radius -p ./src -c src/utils/request.ts -o report.html --graph

  # Use incremental analysis (default)
  blast-radius -p ./src -c src/api/task.ts

  # Clear cache and re-analyze
  blast-radius -p ./src -c src/api/task.ts --clear-cache
`);
}
// ─── JSON序列化辅助 ──────────────────────────────────────────────────────────
/**
 * 安全地序列化对象到JSON，移除循环引用和不可序列化的属性
 */
function safeSerialize(obj, depth = 0) {
    if (depth > 20)
        return '[Max Depth Exceeded]';
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj === 'function')
        return '[Function]';
    if (typeof obj === 'symbol')
        return '[Symbol]';
    // 处理循环引用
    if (depth > 0 && (obj instanceof Map || obj instanceof Set)) {
        if (obj instanceof Map) {
            return Array.from(obj.entries()).map(([k, v]) => [k, safeSerialize(v, depth + 1)]);
        }
        if (obj instanceof Set) {
            return Array.from(obj.values()).map(v => safeSerialize(v, depth + 1));
        }
    }
    // 处理数组
    if (Array.isArray(obj)) {
        return obj.map(item => safeSerialize(item, depth + 1));
    }
    // 处理普通对象
    if (typeof obj === 'object') {
        const result = {};
        for (const key of Object.keys(obj)) {
            try {
                const value = obj[key];
                // 跳过已知包含循环引用的属性
                if (key === 'symbol' || key === 'declaration' || key === 'node' || key === 'checker') {
                    result[key] = '[Complex Object]';
                }
                else if (value && typeof value === 'object') {
                    result[key] = safeSerialize(value, depth + 1);
                }
                else {
                    result[key] = value;
                }
            }
            catch (e) {
                result[key] = '[Serialization Error]';
            }
        }
        return result;
    }
    return obj;
}
/**
 * 提取scope中可序列化的部分用于JSON输出
 */
function extractSerializableScope(scope) {
    if (!scope)
        return {};
    return {
        changedFile: scope.changedFile,
        changedSymbol: scope.changedSymbol,
        changeType: scope.changeType,
        timestamp: scope.timestamp,
        stats: safeSerialize(scope.stats),
        affectedFiles: safeSerialize(scope.affectedFiles),
        recommendations: Array.isArray(scope.recommendations) ? scope.recommendations : [],
        downstreamChain: safeSerialize(scope.downstreamChain),
        callGraph: scope.callGraph ? 'Map(complex object)' : undefined,
        symbolInfo: scope.symbolInfo ? {
            name: scope.symbolInfo.name,
            kind: scope.symbolInfo.kind,
            file: scope.symbolInfo.file,
            line: scope.symbolInfo.line,
        } : null,
        typeDependencies: safeSerialize(scope.typeDependencies),
        exportDependents: safeSerialize(scope.exportDependents),
    };
}
function formatText(scope, callChains, callStackView, typeFlowResult, dataFlowResult) {
    const lines = [];
    // 标题
    lines.push('');
    lines.push('┌─────────────────────────────────────────────────────────────────┐');
    lines.push('│                    📊 改动影响范围分析报告                         │');
    lines.push('└─────────────────────────────────────────────────────────────────┘');
    lines.push('');
    // 改动摘要
    const changedFileName = path.basename(scope.changedFile);
    lines.push('📝 改动内容');
    lines.push('   文件: ' + changedFileName);
    if (scope.changedSymbol) {
        lines.push('   符号: ' + scope.changedSymbol);
    }
    const changeTypeText = { modify: '修改', delete: '删除', rename: '重命名', add: '新增' };
    lines.push('   类型: ' + (changeTypeText[scope.changeType] || scope.changeType));
    lines.push('');
    // 风险等级 - 更直观
    const riskConfig = {
        low: { color: '🟢 低风险', desc: '影响范围小，可以放心发布', bg: '░░░░░░░░░' },
        medium: { color: '🟡 中等风险', desc: '有部分影响，建议检查相关代码', bg: '██████░░░' },
        high: { color: '🟠 高风险', desc: '影响范围较大，需要全面测试', bg: '████████░░' },
        critical: { color: '🔴 极高风险', desc: '核心模块改动，必须谨慎处理', bg: '██████████' },
    };
    const risk = riskConfig[scope.stats.riskLevel] || riskConfig.low;
    lines.push('🚨 风险等级: ' + risk.color);
    lines.push('   ' + risk.desc);
    lines.push('   影响程度: ' + risk.bg + ' (' + scope.stats.impactScore + '分)');
    lines.push('');
    // 简洁的影响统计
    lines.push('📈 影响范围');
    lines.push('   ├─ 受影响文件: ' + scope.stats.totalAffectedFiles + ' 个');
    lines.push('   ├─ 直接引用: ' + scope.stats.directReferences + ' 处');
    lines.push('   └─ 调用点: ' + scope.stats.callSites + ' 处');
    lines.push('');
    // 调用链详情 - 更详细
    if (callChains && callChains.length > 0) {
        lines.push('🔗 调用链路详情');
        lines.push('');
        for (const chain of callChains) {
            const fileName = path.basename(chain.file);
            const filePath = chain.file.replace(/^.*[/\\]src[/\\]/, 'src/');
            lines.push('   📍 ' + fileName);
            lines.push('      路径: ' + filePath);
            lines.push('      行号: 第' + chain.line + '行');
            lines.push('      完整代码:');
            lines.push('        ' + chain.codeContext || chain.callExpression);
            if (chain.returnedTo) {
                lines.push('      返回值赋给: ' + chain.returnedTo);
            }
            if (chain.propertyAccesses.length > 0) {
                lines.push('');
                lines.push('      └─ 属性使用:');
                // 去重并显示
                const uniqueChains = [...new Set(chain.propertyAccesses.map(p => p.accessChain.join('.')))];
                for (const prop of uniqueChains) {
                    const propAccess = chain.propertyAccesses.find(p => p.accessChain.join('.') === prop);
                    const line = propAccess?.line;
                    const context = propAccess?.codeContext || propAccess?.fullExpression || prop;
                    lines.push('         • ' + prop);
                    lines.push('           位置: 第' + line + '行');
                    lines.push('           代码: ' + context);
                }
            }
            lines.push('');
        }
    }
    // 调用栈视图 - 从改动点向上追踪
    if (callStackView && callStackView.depth > 0) {
        lines.push('📞 调用栈视图');
        lines.push('');
        const renderNode = (node, prefix, isLast, isRoot) => {
            const connector = isLast ? '└─' : '├─';
            const current = isRoot
                ? `📍 ${node.name} (改动点)`
                : `${connector} ${node.name}`;
            const typeTag = ` [${node.type || 'function'}]`;
            lines.push(`${prefix}${current}${typeTag} → ${path.basename(node.file)}:${node.line}`);
            if (node.callSite) {
                lines.push(`${prefix}  │`);
                lines.push(`${prefix}  └── 调用: 第${node.callSite.line}行 "${node.callSite.expression}"`);
            }
            const childPrefix = prefix + (isLast ? '   ' : '│  ');
            if (node.children && node.children.length > 0) {
                node.children.forEach((child, idx) => {
                    const isChildLast = idx === node.children.length - 1;
                    renderNode(child, childPrefix, isChildLast, false);
                });
            }
        };
        renderNode(callStackView.root, '', true, true);
        lines.push('');
        lines.push(`   深度: ${callStackView.depth} 层`);
        lines.push('');
    }
    // 类型流分析 - 检测类型不兼容
    if (typeFlowResult && typeFlowResult.method) {
        lines.push('🔬 类型流分析');
        lines.push('');
        if (typeFlowResult.hasIncompatibilities) {
            lines.push(`   ⚠️  检测到 ${typeFlowResult.incompatibilities.length} 处类型不兼容`);
            lines.push(`      分析方法: ${typeFlowResult.method} | 可信度: ${typeFlowResult.confidence}`);
            lines.push('');
            for (const item of typeFlowResult.incompatibilities.slice(0, 5)) {
                lines.push(`   📍 ${path.basename(item.file)}:${item.line}`);
                lines.push(`      原因: ${item.reason}`);
                if (item.propertyAccess && item.propertyAccess.length > 0) {
                    lines.push(`      属性: ${item.propertyAccess.join(' → ')}`);
                }
                lines.push('');
            }
        }
        else {
            lines.push('   ✅ 未检测到类型不兼容');
            lines.push(`      分析方法: ${typeFlowResult.method} | 可信度: ${typeFlowResult.confidence}`);
        }
        lines.push('');
    }
    // 数据流分析 - 追踪数据在程序中的流转
    if (dataFlowResult && dataFlowResult.statistics) {
        lines.push('📊 数据流分析 (DataFlow Pro)');
        lines.push('');
        lines.push(`   节点分析: ${dataFlowResult.statistics.nodesAnalyzed}`);
        lines.push(`   路径追踪: ${dataFlowResult.statistics.pathsTracked}`);
        lines.push(`   约束生成: ${dataFlowResult.statistics.constraintsGenerated}`);
        lines.push(`   Promise解包: ${dataFlowResult.statistics.promiseUnwraps}`);
        lines.push(`   条件分支: ${dataFlowResult.statistics.conditionalBranches}`);
        lines.push(`   类型收窄: ${dataFlowResult.statistics.typesNarrowed}`);
        lines.push(`   置信度: ${dataFlowResult.confidence}`);
        lines.push(`   耗时: ${dataFlowResult.duration}ms`);
        lines.push('');
        if (dataFlowResult.typeNarrowing && dataFlowResult.typeNarrowing.size > 0) {
            lines.push('   🔽 类型收窄:');
            for (const [varName, narrowing] of dataFlowResult.typeNarrowing) {
                lines.push(`      ${varName}:`);
                for (const n of narrowing) {
                    lines.push(`        → 第${n.line}行: ${n.types.join(' | ')}`);
                }
            }
            lines.push('');
        }
        if (dataFlowResult.flowPaths && dataFlowResult.flowPaths.length > 0) {
            lines.push('   🔗 数据流路径:');
            for (const fp of dataFlowResult.flowPaths.slice(0, 3)) {
                lines.push(`      ${fp.source}`);
                lines.push(`        ↓ ${fp.typeAtSource}`);
                for (const node of fp.path.slice(0, 3)) {
                    lines.push(`        → ${node.expression} (${node.type})`);
                }
                lines.push(`        → ${fp.sink}`);
                lines.push('');
            }
        }
    }
    // 传播路径 - 对于非函数符号（如常量、类型）显示传播链
    if (scope.propagationPaths && scope.propagationPaths.length > 0) {
        lines.push('🔗 传播路径详情');
        lines.push('');
        for (const pp of scope.propagationPaths.slice(0, 10)) {
            const fromName = pp.path[0] || pp.from;
            const toName = path.basename(pp.to);
            const chain = pp.path.join(' → ') || `${fromName} → ${toName}`;
            lines.push(`   📍 ${chain}`);
            lines.push(`      位置: ${toName}`);
            lines.push(`      类型: ${pp.type}`);
            lines.push('');
        }
    }
    // 受影响的文件列表 - 更清晰
    if (scope.affectedFiles.length > 0) {
        lines.push('📁 受影响的文件');
        for (const af of scope.affectedFiles.slice(0, 10)) {
            const fileName = path.basename(af.file);
            const refCount = af.references.length;
            const fileType = af.category || '其他';
            // 文件类型的中文
            const fileTypeText = {
                'API Layer': 'API接口',
                'Page': '页面',
                'Component': '组件',
                'Hook': '钩子函数',
                'State Management': '状态管理',
                'Context': '上下文',
                'Utility': '工具函数',
                'Service': '服务',
                'Type Definition': '类型定义',
                'Other': '其他',
            };
            lines.push('   📄 ' + fileName);
            lines.push('      位置: ' + fileTypeText[fileType] || fileType);
            lines.push('      引用: ' + refCount + ' 处');
            lines.push('');
        }
        if (scope.affectedFiles.length > 10) {
            lines.push('   ... 还有 ' + (scope.affectedFiles.length - 10) + ' 个文件受影响');
            lines.push('');
        }
    }
    // 改动建议
    if (scope.recommendations.length > 0) {
        lines.push('💡 建议');
        for (const rec of scope.recommendations) {
            // 去掉 emoji 前的特殊字符，只保留主要文字
            const cleanRec = rec.replace(/^[^\u4e00-\u9fa5]*/g, '').trim();
            lines.push('   • ' + cleanRec);
        }
        lines.push('');
    }
    // 简单总结
    if (scope.stats.totalAffectedFiles <= 1 && scope.stats.callSites <= 2) {
        lines.push('✅ 总结: 此改动影响很小，可以正常发布');
    }
    else if (scope.stats.totalAffectedFiles <= 5) {
        lines.push('⚠️ 总结: 此改动有少量影响，发布前建议检查相关文件');
    }
    else {
        lines.push('🔴 总结: 此改动影响范围较大，建议进行充分测试后再发布');
    }
    lines.push('');
    return lines.join('\n');
}
/**
 * 渲染调用栈HTML
 */
function renderCallStackHtml(node, isRoot = false) {
    const typeColors = {
        function: '#667eea',
        arrow: '#11998e',
        method: '#f5576c',
        component: '#764ba2',
    };
    const color = typeColors[node.type] || '#667eea';
    let html = `
  <div class="stack-node ${isRoot ? 'stack-root' : ''}" style="border-left-color: ${color}">
    <div class="stack-header">
      <span class="stack-tag">${isRoot ? '📍' : '→'}</span>
      <span class="stack-name">${node.name}</span>
      ${isRoot ? '<span class="stack-root-badge">改动点</span>' : ''}
      <span class="stack-type" style="background: ${color}">${node.type || 'function'}</span>
    </div>
    <div class="stack-location">${path.basename(node.file)}:${node.line}</div>`;
    if (node.callSite) {
        html += `
    <div class="stack-call">
      <code>第${node.callSite.line}行: ${node.callSite.expression}</code>
    </div>`;
    }
    if (node.children && node.children.length > 0) {
        html += `<div class="stack-children">`;
        node.children.forEach((child) => {
            html += renderCallStackHtml(child, false);
        });
        html += `</div>`;
    }
    html += `</div>`;
    return html;
}
function formatHtml(scope, callChains, callStackView, typeFlowResult, dataFlowResult) {
    const riskConfig = {
        low: { color: '#28a745', label: '低风险', bar: '░░░░░░░░░' },
        medium: { color: '#ffc107', label: '中等风险', bar: '██████░░░' },
        high: { color: '#fd7e14', label: '高风险', bar: '████████░░' },
        critical: { color: '#dc3545', label: '极高风险', bar: '██████████' },
    };
    const risk = riskConfig[scope.stats.riskLevel] || riskConfig.low;
    const fileTypeMap = {
        'API Layer': 'API接口',
        'Page': '页面',
        'Component': '组件',
        'Hook': '钩子函数',
        'State Management': '状态管理',
        'Context': '上下文',
        'Utility': '工具函数',
        'Service': '服务',
        'Type Definition': '类型定义',
        'Other': '其他',
    };
    // Build call chain HTML
    let callChainHtml = '';
    if (callChains && callChains.length > 0) {
        callChainHtml = `
    <h2>🔗 调用链路详情</h2>
    <div class="call-chains">`;
        for (const chain of callChains) {
            const fileName = path.basename(chain.file);
            const codeCtx = chain.codeContext || chain.callExpression;
            const uniqueProps = [...new Set(chain.propertyAccesses.map(p => p.accessChain.join('.')))];
            callChainHtml += `
      <div class="call-chain-item">
        <div class="call-chain-header">
          <span class="call-file">📍 ${fileName}</span>
          <span class="call-line">第${chain.line}行</span>
        </div>
        <div class="code-context">
          <div class="code-label">完整代码:</div>
          <pre class="code-block">${codeCtx}</pre>
        </div>
        ${chain.returnedTo ? `<div class="call-return">返回值 → <code>${chain.returnedTo}</code></div>` : ''}
        ${uniqueProps.length > 0 ? `
        <div class="call-props">
          <span class="props-label">属性使用:</span>
          <div class="props-list">` +
                uniqueProps.map(p => {
                    const propAccess = chain.propertyAccesses.find(pp => pp.accessChain.join('.') === p);
                    const propLine = propAccess?.line;
                    const propContext = propAccess?.codeContext || propAccess?.fullExpression || p;
                    return `<div class="prop-item">
                <span class="prop-tag">${p}</span>
                <div class="prop-context">
                  <span class="prop-line">行${propLine}:</span>
                  <code>${propContext}</code>
                </div>
              </div>`;
                }).join('') + `
          </div>
        </div>` : ''}
      </div>`;
        }
        callChainHtml += `
    </div>`;
    }
    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>改动影响分析报告 - ${path.basename(scope.changedFile)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 40px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
    .container { background: white; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); padding: 40px; }
    h1 { color: #1a1a2e; margin: 0 0 30px 0; font-size: 2em; }
    h2 { color: #333; margin: 30px 0 15px 0; font-size: 1.2em; border-bottom: 2px solid #eee; padding-bottom: 10px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; }
    .badge { background: ${risk.color}; color: white; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 1.1em; }
    .change-info { background: #f8f9fa; padding: 20px; border-radius: 12px; margin-bottom: 20px; }
    .change-info p { margin: 8px 0; color: #555; }
    .change-info strong { color: #333; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
    .stat-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; text-align: center; }
    .stat-card.green { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
    .stat-card.orange { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
    .stat-card.blue { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
    .stat-value { font-size: 2.5em; font-weight: bold; }
    .stat-label { font-size: 0.9em; opacity: 0.9; margin-top: 5px; }
    .risk-bar { font-size: 1.5em; letter-spacing: 2px; color: #666; }
    .file-list { list-style: none; padding: 0; margin: 0; }
    .file-item { background: #f8f9fa; padding: 20px; border-radius: 12px; margin: 12px 0; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #667eea; }
    .file-item:hover { background: #f0f4ff; }
    .file-name { font-weight: bold; color: #333; font-size: 1.1em; }
    .file-type { color: #666; font-size: 0.9em; }
    .file-refs { background: #667eea; color: white; padding: 5px 15px; border-radius: 20px; font-size: 0.9em; }
    .recommendation { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 20px; border-radius: 12px; margin-top: 20px; }
    .summary { background: #f8f9fa; padding: 20px; border-radius: 12px; margin-top: 20px; text-align: center; font-size: 1.1em; color: #333; }
    .footer { margin-top: 30px; text-align: center; color: #999; font-size: 0.85em; }
    .call-chains { display: flex; flex-direction: column; gap: 15px; }
    .call-chain-item { background: #f8f9fa; padding: 20px; border-radius: 12px; border-left: 4px solid #11998e; }
    .call-chain-header { display: flex; justify-content: space-between; margin-bottom: 10px; }
    .call-file { font-weight: bold; color: #333; font-size: 1.1em; }
    .call-line { color: #666; }
    .call-expression, .call-return { color: #555; margin: 5px 0; font-size: 0.95em; }
    .call-expression code, .call-return code { background: #e9ecef; padding: 2px 8px; border-radius: 4px; color: #667eea; }
    .call-props { margin-top: 12px; }
    .props-label { color: #666; font-size: 0.9em; }
    .props-list { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
    .prop-tag { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 4px 12px; border-radius: 15px; font-size: 0.85em; display: inline-block; margin-bottom: 5px; }
    .prop-item { background: #fff; padding: 10px; border-radius: 8px; border: 1px solid #e9ecef; }
    .prop-context { margin-top: 5px; }
    .prop-line { color: #666; font-size: 0.85em; }
    .prop-context code { background: #f8f9fa; padding: 3px 8px; border-radius: 4px; color: #333; font-size: 0.9em; }
    .code-context { background: #fff; border-radius: 8px; padding: 12px; margin: 10px 0; border: 1px solid #e9ecef; }
    .code-label { color: #666; font-size: 0.85em; margin-bottom: 5px; }
    .code-block { background: #1a1a2e; color: #00d4ff; padding: 12px; border-radius: 6px; margin: 0; font-size: 0.9em; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    .call-stack { display: flex; flex-direction: column; gap: 8px; }
    .stack-node { background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #11998e; }
    .stack-root { border-left-color: #dc3545; }
    .stack-header { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; }
    .stack-tag { font-size: 1.2em; }
    .stack-name { font-weight: bold; color: #333; font-size: 1.1em; }
    .stack-type { color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.75em; background: #667eea; }
    .stack-root-badge { background: #dc3545; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.75em; margin-left: 5px; }
    .stack-location { color: #666; font-size: 0.9em; margin-left: 30px; }
    .stack-call { margin-top: 8px; margin-left: 30px; }
    .stack-call code { background: #e9ecef; padding: 2px 6px; border-radius: 4px; color: #667eea; font-size: 0.85em; }
    .stack-children { margin-left: 30px; margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
    .stack-depth { margin-top: 15px; padding: 10px; background: #f0f4ff; border-radius: 8px; font-size: 0.9em; color: #666; }
    .stack-depth strong { color: #333; }
    .type-result-ok { background: #f0f9f4; border: 1px solid #11998e; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 5px; }
    .type-result-warn { background: #fff5f5; border: 1px solid #f5576c; border-radius: 8px; padding: 15px; }
    .type-result-warn p { margin: 0; }
    .type-result-warn strong { color: #f5576c; }
    .type-result-warn .meta, .type-result-ok .meta { font-size: 0.85em; color: #666; }
    .type-list { display: flex; flex-direction: column; gap: 10px; margin-top: 15px; }
    .type-item { background: #f8f9fa; border-radius: 8px; padding: 15px; border-left: 4px solid #f5576c; }
    .type-location { display: flex; justify-content: space-between; margin-bottom: 10px; }
    .type-location .file { font-weight: bold; color: #333; }
    .confidence.high { background: #dc3545; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; }
    .confidence.medium { background: #ffc107; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; }
    .confidence.low { background: #6c757d; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; }
    .type-details { display: flex; flex-direction: column; gap: 5px; font-size: 0.95em; }
    .type-details code { background: #e9ecef; padding: 2px 6px; border-radius: 4px; color: #667eea; }
    .reason { color: #f5576c; margin-top: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 改动影响范围分析报告</h1>
      <div class="badge">${risk.label}</div>
    </div>

    <div class="change-info">
      <p><strong>📁 改动文件:</strong> ${path.basename(scope.changedFile)}</p>
      ${scope.changedSymbol ? `<p><strong>🔤 改动符号:</strong> ${scope.changedSymbol}</p>` : ''}
      <p><strong>📝 改动类型:</strong> ${scope.changeType === 'modify' ? '修改' : scope.changeType === 'delete' ? '删除' : scope.changeType}</p>
      <p><strong>⏰ 分析时间:</strong> ${new Date(scope.timestamp).toLocaleString('zh-CN')}</p>
    </div>

    <div class="risk-bar">影响程度: ${risk.bar} (${scope.stats.impactScore}分)</div>

    <h2>📈 影响范围统计</h2>
    <div class="stats">
      <div class="stat-card green">
        <div class="stat-value">${scope.stats.totalAffectedFiles}</div>
        <div class="stat-label">受影响文件</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-value">${scope.stats.directReferences}</div>
        <div class="stat-label">直接引用</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-value">${scope.stats.callSites}</div>
        <div class="stat-label">调用点</div>
      </div>
    </div>

    ${callChainHtml}

    ${callStackView && callStackView.depth > 0 ? `
    <h2>📞 调用栈视图</h2>
    <div class="call-stack">
      ${renderCallStackHtml(callStackView.root)}
      <div class="stack-depth">深度: <strong>${callStackView.depth}</strong> 层</div>
    </div>
    ` : ''}

    ${typeFlowResult && typeFlowResult.method ? `
    ${typeFlowResult.hasIncompatibilities ? `
    <h2>🔬 类型流分析 ⚠️</h2>
    <div class="type-result-warn">
      <p>检测到 <strong>${typeFlowResult.incompatibilities.length}</strong> 处类型不兼容</p>
      <p class="meta">分析方法: ${typeFlowResult.method} | 可信度: ${typeFlowResult.confidence}</p>
    </div>
    <div class="type-list">
      ${typeFlowResult.incompatibilities.slice(0, 5).map((item) => `
      <div class="type-item">
        <div class="type-location">
          <span class="file">📄 ${path.basename(item.file)}:${item.line}</span>
          <span class="confidence ${item.confidence || typeFlowResult.confidence}">${typeFlowResult.confidence}</span>
        </div>
        <div class="type-details">
          ${item.expression ? `<div>调用: <code>${item.expression}</code></div>` : ''}
          ${item.reason ? `<div class="reason">原因: ${item.reason}</div>` : ''}
        </div>
      </div>`).join('')}
    </div>
    ` : `
    <h2>🔬 类型流分析</h2>
    <div class="type-result-ok">
      <span>✅ 未检测到类型不兼容</span>
      <span class="meta">分析方法: ${typeFlowResult.method} | 可信度: ${typeFlowResult.confidence}</span>
    </div>
    `}
    ` : ''}

    <h2>📁 受影响的文件</h2>
    <ul class="file-list">`;
    for (const af of scope.affectedFiles.slice(0, 20)) {
        const fileTypeText = fileTypeMap[af.category] || af.category || '其他';
        html += `
      <li class="file-item">
        <div>
          <div class="file-name">${path.basename(af.file)}</div>
          <div class="file-type">${af.file}</div>
          <div class="file-type">类型: ${fileTypeText}</div>
        </div>
        <div class="file-refs">${af.references.length} 处引用</div>
      </li>`;
    }
    html += `
    </ul>`;
    // Summary recommendation
    let summaryText = '✅ 此改动影响很小，可以正常发布';
    if (scope.stats.totalAffectedFiles <= 1 && scope.stats.callSites <= 2) {
        summaryText = '✅ 此改动影响很小，可以正常发布';
    }
    else if (scope.stats.totalAffectedFiles <= 5) {
        summaryText = '⚠️ 此改动有少量影响，发布前建议检查相关文件';
    }
    else {
        summaryText = '🔴 此改动影响范围较大，建议进行充分测试后再发布';
    }
    html += `
    <div class="summary">${summaryText}</div>
    <div class="footer">由 Blast Radius Analyzer 自动生成</div>
  </div>
</body>
</html>`;
    return html;
}
// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
    const args = parseArgs(process.argv);
    if (args.changes.length === 0) {
        console.error('❌ Error: No changes specified. Use --change <file>');
        console.error('   Run with --help for usage information');
        process.exit(1);
    }
    // 初始化缓存
    const cache = new AnalysisCache(args.projectRoot);
    if (args.clearCache) {
        cache.clear();
        console.log('🗑️  Cache cleared');
    }
    const cacheStats = cache.getStats();
    console.log('💥 Blast Radius Analyzer');
    console.log(`   Project: ${args.projectRoot}`);
    console.log(`   Changes: ${args.changes.map((c) => `${c.file}${c.symbol ? `#${c.symbol}` : ''} (${c.type})`).join(', ')}`);
    if (args.useCache) {
        console.log(`   Cache: ${cacheStats.entries} entries, ${cacheStats.files} files tracked`);
    }
    else {
        console.log('   Cache: disabled');
    }
    console.log('');
    const config = {
        projectRoot: args.projectRoot,
        tsConfigPath: args.tsConfig,
        maxDepth: args.maxDepth,
        includeNodeModules: false,
        includeTests: args.includeTests,
        criticalPatterns: [
            '**/main.ts',
            '**/index.ts',
            '**/App.tsx',
            '**/App.ts',
            '**/routes/**',
            '**/entry*.ts',
        ],
        ignorePatterns: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**'],
        verbose: args.verbose,
        outputFormat: args.format,
    };
    const tracer = new ImpactTracer(args.projectRoot, args.tsConfig, config);
    try {
        console.log('🔍 Initializing symbol analyzer...');
        await tracer.initialize();
        // 检查是否有缓存的未变更文件
        const changedFiles = args.changes.map(c => c.file);
        const changedFilesList = cache.getChangedFiles(changedFiles);
        if (args.useCache && changedFilesList.length === 0) {
            console.log('📦 Using cached analysis results (no file changes detected)');
        }
        else {
            if (changedFilesList.length > 0 && args.useCache) {
                console.log(`🔄 Re-analyzing ${changedFilesList.length} changed file(s)`);
            }
            console.log('🔬 Analyzing blast radius...');
        }
        const scopes = await Promise.all(args.changes.map((change) => tracer.traceImpact(change.file, change.symbol, change.type)));
        // 更新缓存
        if (args.useCache) {
            for (const change of args.changes) {
                cache.updateFileState(change.file);
            }
        }
        // 合并结果（简化处理，只显示第一个）
        const primaryScope = scopes[0];
        // 调用链分析 - 获取属性访问详情
        let callChains = [];
        if (primaryScope.changedSymbol) {
            try {
                const propTracker = new PropertyAccessTracker(args.projectRoot, args.tsConfig);
                // 只分析受影响的文件
                const affectedFileNames = primaryScope.affectedFiles
                    .map(af => path.basename(af.file))
                    .filter((name, idx, arr) => arr.indexOf(name) === idx); // 去重
                const propResults = propTracker.analyzeFunctionCalls(primaryScope.changedSymbol, affectedFileNames);
                callChains = propResults.map(r => ({
                    file: r.file,
                    line: r.line,
                    callExpression: r.callExpression,
                    returnedTo: r.returnedTo,
                    codeContext: r.codeContext || r.callExpression,
                    propertyAccesses: r.propertyAccesses.map(p => ({
                        accessChain: p.accessChain,
                        line: p.line,
                        fullExpression: p.fullExpression,
                        codeContext: p.codeContext || p.fullExpression,
                    })),
                }));
            }
            catch (e) {
                // 忽略错误
            }
        }
        // 下游链路详情
        const downstreamChain = primaryScope.downstreamChain || [];
        // 调用栈视图 - 从改动点向上追踪到入口
        let callStackView = null;
        if (primaryScope.changedSymbol && primaryScope.symbolInfo) {
            try {
                const stackBuilder = new CallStackBuilder(args.projectRoot, args.tsConfig);
                stackBuilder.addSourceFiles([`${args.projectRoot}/**/*.ts`, `${args.projectRoot}/**/*.tsx`]);
                callStackView = stackBuilder.buildCallStack(primaryScope.changedSymbol, primaryScope.changedFile);
            }
            catch (e) {
                // 忽略调用栈构建错误
            }
        }
        // 类型流分析 - 检测类型不兼容
        let typeFlowResult = null;
        let dataFlowResult = null;
        if (primaryScope.changedSymbol && primaryScope.symbolInfo) {
            try {
                const typeFlowAnalyzer = new TypeFlowAnalyzer(args.projectRoot, args.tsConfig);
                typeFlowResult = typeFlowAnalyzer.analyzeTypeFlow(primaryScope.changedSymbol, primaryScope.changedFile);
            }
            catch (e) {
                // 忽略类型流分析错误
            }
            try {
                const dataFlowAnalyzer = new DataFlowAnalyzer(args.projectRoot, args.tsConfig);
                dataFlowResult = dataFlowAnalyzer.analyzeDataFlow(primaryScope.changedSymbol, primaryScope.changedFile);
            }
            catch (e) {
                // 忽略数据流分析错误
            }
        }
        // 如果是 graph 格式，生成依赖图
        if (args.format === 'graph') {
            const graphBuilder = new DependencyGraphBuilder();
            const graph = graphBuilder.build(primaryScope.symbolInfo, primaryScope.categorized.calls.concat(primaryScope.categorized.types, primaryScope.categorized.exports, primaryScope.categorized.properties), primaryScope.changedFile);
            const graphHtml = graphBuilder.generateInteractiveHtml(graph, path.basename(primaryScope.changedFile));
            const graphOutput = args.output || '/tmp/blast-radius-graph.html';
            fs.writeFileSync(graphOutput, graphHtml, 'utf-8');
            console.log(`\n✅ Dependency graph written to: ${graphOutput}`);
            console.log('   Open in a browser to view the interactive graph');
            return;
        }
        // 输出
        let output;
        let exitCode = 0;
        // CI/CD 阈值检查
        if (args.threshold) {
            const alerts = [];
            if (args.threshold.files && primaryScope.stats.totalAffectedFiles > args.threshold.files) {
                alerts.push(`受影响文件数 ${primaryScope.stats.totalAffectedFiles} 超过阈值 ${args.threshold.files}`);
            }
            if (args.threshold.score && primaryScope.stats.impactScore > args.threshold.score) {
                alerts.push(`影响分数 ${primaryScope.stats.impactScore} 超过阈值 ${args.threshold.score}`);
            }
            if (args.threshold.typeErrors && typeFlowResult && typeFlowResult.incompatibilities.length > args.threshold.typeErrors) {
                alerts.push(`类型不兼容 ${typeFlowResult.incompatibilities.length} 超过阈值 ${args.threshold.typeErrors}`);
            }
            if (alerts.length > 0) {
                console.error('\n🚨 CI/CD 阈值告警:');
                for (const alert of alerts) {
                    console.error(`   ⚠️  ${alert}`);
                }
                exitCode = 2; // 阈值告警使用退出码 2
            }
        }
        switch (args.format) {
            case 'json':
                output = JSON.stringify({ ...extractSerializableScope(primaryScope), callChains, callStackView, typeFlowResult }, null, 2);
                break;
            case 'html':
                output = formatHtml(primaryScope, callChains, callStackView, typeFlowResult, dataFlowResult);
                break;
            default:
                output = formatText(primaryScope, callChains, callStackView, typeFlowResult, dataFlowResult);
        }
        if (args.output) {
            fs.writeFileSync(args.output, output, 'utf-8');
            console.log(`\n✅ Report written to: ${args.output}`);
        }
        else {
            console.log('\n' + output);
        }
        if (exitCode > 0) {
            process.exit(exitCode);
        }
    }
    catch (error) {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    }
}
main();
