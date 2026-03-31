/**
 * DependencyGraph - 依赖图可视化
 *
 * 生成交互式依赖图和影响链图形
 */

import * as path from 'path';
import type { ReferenceInfo, SymbolInfo } from './SymbolAnalyzer.js';

export interface GraphNode {
  id: string;
  label: string;
  type: 'file' | 'symbol' | 'category';
  category?: string;
  risk?: 'low' | 'medium' | 'high' | 'critical';
  impact?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'import' | 'call' | 'type' | 'export' | 'property';
  weight?: number;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class DependencyGraphBuilder {
  /**
   * 构建依赖图
   */
  build(
    symbolInfo: SymbolInfo,
    references: ReferenceInfo[],
    changedFile: string
  ): DependencyGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeMap = new Map<string, GraphNode>();

    // 添加变更文件的节点
    const changedNode: GraphNode = {
      id: changedFile,
      label: path.basename(changedFile),
      type: 'file',
      category: this.categorizeFile(changedFile),
      risk: 'high',
      impact: 100,
    };
    nodes.push(changedNode);
    nodeMap.set(changedFile, changedNode);

    // 按文件分组引用
    const refsByFile = new Map<string, ReferenceInfo[]>();
    for (const ref of references) {
      const file = ref.location.file;
      if (!refsByFile.has(file)) {
        refsByFile.set(file, []);
      }
      refsByFile.get(file)!.push(ref);
    }

    // 添加引用文件的节点和边
    for (const [file, refs] of refsByFile) {
      if (file === changedFile) continue;

      const category = this.categorizeFile(file);

      // 计算文件影响度
      const impact = refs.length * 5;

      const fileNode: GraphNode = {
        id: file,
        label: path.basename(file),
        type: 'file',
        category,
        impact,
      };
      nodes.push(fileNode);
      nodeMap.set(file, fileNode);

      // 创建边
      for (const ref of refs) {
        const edgeType = this.mapReferenceType(ref.referenceType);
        const weight = this.getEdgeWeight(ref.referenceType);

        edges.push({
          source: changedFile,
          target: file,
          type: edgeType,
          weight,
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * 分类文件
   */
  private categorizeFile(filePath: string): string {
    if (filePath.includes('/api/')) return 'API';
    if (filePath.includes('/components/')) return 'Component';
    if (filePath.includes('/pages/') || filePath.includes('/views/')) return 'Page';
    if (filePath.includes('/hooks/')) return 'Hook';
    if (filePath.includes('/utils/')) return 'Utility';
    if (filePath.includes('/store/') || filePath.includes('/redux') || filePath.includes('/mobx')) return 'State';
    if (filePath.includes('/context') || filePath.includes('/Context')) return 'Context';
    if (filePath.includes('/types/')) return 'Type';
    return 'Other';
  }

  /**
   * 映射引用类型到边类型
   */
  private mapReferenceType(refType: string): GraphEdge['type'] {
    switch (refType) {
      case 'import':
        return 'import';
      case 'call':
        return 'call';
      case 'type':
        return 'type';
      case 'export':
        return 'export';
      case 'property':
        return 'property';
      default:
        return 'import';
    }
  }

  /**
   * 获取边权重
   */
  private getEdgeWeight(refType: string): number {
    switch (refType) {
      case 'call': return 10;
      case 'type': return 8;
      case 'export': return 20;
      case 'property': return 5;
      default: return 1;
    }
  }

  /**
   * 生成交互式 HTML 图表
   */
  generateInteractiveHtml(graph: DependencyGraph, title: string): string {
    const nodesJson = JSON.stringify(graph.nodes);
    const edgesJson = JSON.stringify(graph.edges);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title} - Dependency Graph</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #1a1a2e;
      color: #eee;
    }
    h1 {
      color: #00d4ff;
      border-bottom: 2px solid #00d4ff;
      padding-bottom: 10px;
    }
    #graph {
      width: 100%;
      height: 600px;
      border: 1px solid #333;
      border-radius: 8px;
      background: #16213e;
    }
    .node {
      cursor: pointer;
    }
    .node circle {
      stroke: #fff;
      stroke-width: 2px;
      transition: all 0.3s;
    }
    .node:hover circle {
      stroke: #00d4ff;
      stroke-width: 3px;
    }
    .node text {
      font-size: 10px;
      fill: #fff;
      pointer-events: none;
    }
    .link {
      stroke: #4a5568;
      stroke-opacity: 0.6;
      fill: none;
    }
    .link.call { stroke: #48bb78; }
    .link.type { stroke: #4299e1; }
    .link.export { stroke: #ed8936; }
    .link.property { stroke: #9f7aea; }
    .link.import { stroke: #718096; }

    .legend {
      position: absolute;
      top: 20px;
      right: 20px;
      background: #16213e;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #333;
    }
    .legend-item {
      display: flex;
      align-items: center;
      margin: 5px 0;
    }
    .legend-color {
      width: 20px;
      height: 3px;
      margin-right: 10px;
      border-radius: 2px;
    }
    .legend-color.call { background: #48bb78; }
    .legend-color.type { background: #4299e1; }
    .legend-color.export { background: #ed8936; }
    .legend-color.property { background: #9f7aea; }
    .legend-color.import { background: #718096; }

    .tooltip {
      position: absolute;
      background: #2d3748;
      padding: 10px;
      border-radius: 4px;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .tooltip.visible {
      opacity: 1;
    }

    .stats {
      display: flex;
      gap: 20px;
      margin: 20px 0;
    }
    .stat {
      background: #16213e;
      padding: 15px 25px;
      border-radius: 8px;
      border: 1px solid #333;
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
      color: #00d4ff;
    }
    .stat-label {
      color: #888;
      font-size: 0.9em;
    }

    .category-API { fill: #6f42c1; }
    .category-Component { fill: #20c997; }
    .category-Page { fill: #007bff; }
    .category-Hook { fill: #fd7e14; }
    .category-Utility { fill: #6c757d; }
    .category-State { fill: #dc3545; }
    .category-Context { fill: #e83e8c; }
    .category-Type { fill: #17a2b8; }
    .category-Other { fill: #6c757d; }
  </style>
</head>
<body>
  <h1>💥 ${title}</h1>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${graph.nodes.length}</div>
      <div class="stat-label">Nodes</div>
    </div>
    <div class="stat">
      <div class="stat-value">${graph.edges.length}</div>
      <div class="stat-label">Edges</div>
    </div>
  </div>

  <div id="graph"></div>

  <div class="legend">
    <div class="legend-item"><div class="legend-color call"></div>Call</div>
    <div class="legend-item"><div class="legend-color type"></div>Type Reference</div>
    <div class="legend-item"><div class="legend-color export"></div>Export</div>
    <div class="legend-item"><div class="legend-color property"></div>Property Access</div>
    <div class="legend-item"><div class="legend-color import"></div>Import</div>
  </div>

  <div class="tooltip" id="tooltip"></div>

  <script>
    const nodes = ${nodesJson};
    const edges = ${edgesJson};

    const width = document.getElementById('graph').clientWidth;
    const height = document.getElementById('graph').clientHeight;

    const svg = d3.select('#graph')
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    // 创建缩放行为
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    const g = svg.append('g');

    // 力导向图
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    // 绘制边
    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('class', d => 'link ' + d.type)
      .attr('stroke-width', d => d.weight || 1);

    // 绘制节点
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

    node.append('circle')
      .attr('r', d => d.impact ? Math.min(20, 8 + d.impact / 10) : 12)
      .attr('fill', d => {
        const cat = d.category || 'Other';
        const colors = {
          'API': '#6f42c1',
          'Component': '#20c997',
          'Page': '#007bff',
          'Hook': '#fd7e14',
          'Utility': '#6c757d',
          'State': '#dc3545',
          'Context': '#e83e8c',
          'Type': '#17a2b8',
          'Other': '#6c757d'
        };
        return colors[cat] || '#6c757d';
      });

    node.append('text')
      .attr('dx', 15)
      .attr('dy', 4)
      .text(d => d.label);

    // 节点悬停提示
    const tooltip = d3.select('#tooltip');

    node.on('mouseover', (event, d) => {
      tooltip.classed('visible', true)
        .html('<strong>' + d.label + '</strong><br/>' +
              'Type: ' + (d.category || 'Unknown') + '<br/>' +
              'Impact: ' + (d.impact || 0));
      tooltip.style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', () => {
      tooltip.classed('visible', false);
    });

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
    });

    function dragstarted(event) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }
  </script>
</body>
</html>`;
  }

  /**
   * 生成传播路径图
   */
  generatePropagationHtml(
    paths: Array<{ from: string; to: string; path: string[]; type: string }>,
    title: string
  ): string {
    if (paths.length === 0) {
      return `<html><body style="font-family: sans-serif; padding: 20px;">
        <h2>${title}</h2>
        <p>No propagation paths found.</p>
      </body></html>`;
    }

    // 简化版本：使用节点列表和边
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeSet = new Set<string>();

    for (const p of paths) {
      for (const n of p.path) {
        nodeSet.add(n);
      }
    }

    let nodeId = 0;
    const nodeMap = new Map<string, string>();
    for (const n of nodeSet) {
      const id = 'node_' + nodeId++;
      nodeMap.set(n, id);
      nodes.push({
        id,
        label: n,
        type: 'symbol',
      });
    }

    for (const p of paths) {
      for (let i = 0; i < p.path.length - 1; i++) {
        edges.push({
          source: nodeMap.get(p.path[i])!,
          target: nodeMap.get(p.path[i + 1])!,
          type: p.type as GraphEdge['type'],
        });
      }
    }

    const nodesJson = JSON.stringify(nodes);
    const edgesJson = JSON.stringify(edges);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title} - Propagation Paths</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #1a1a2e;
      color: #eee;
    }
    h1 {
      color: #00d4ff;
      border-bottom: 2px solid #00d4ff;
      padding-bottom: 10px;
    }
    #graph {
      width: 100%;
      height: 500px;
      border: 1px solid #333;
      border-radius: 8px;
      background: #16213e;
    }
    .node circle {
      fill: #00d4ff;
      stroke: #fff;
      stroke-width: 2px;
    }
    .node text {
      font-size: 12px;
      fill: #fff;
    }
    .link {
      stroke: #4a5568;
      stroke-width: 2px;
      fill: none;
      marker-end: url(#arrowhead);
    }
    .link.call { stroke: #48bb78; }
    .link.type { stroke: #4299e1; }
    svg {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <h1>🔗 ${title} - Impact Propagation</h1>
  <p>Showing how changes flow through the codebase</p>
  <div id="graph">
    <svg>
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="20" refY="5"
                markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#718096" />
        </marker>
      </defs>
    </svg>
  </div>
  <script>
    const nodes = ${nodesJson};
    const edges = ${edgesJson};

    const svg = d3.select('#graph svg');
    const width = document.getElementById('graph').clientWidth;
    const height = document.getElementById('graph').clientHeight;

    const g = svg.append('g');

    // 力导向图
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2));

    const link = g.selectAll('.link')
      .data(edges)
      .join('path')
      .attr('class', d => 'link ' + d.type);

    const node = g.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node');

    node.append('circle').attr('r', 10);
    node.append('text')
      .attr('dy', 4)
      .attr('dx', 15)
      .text(d => d.label);

    simulation.on('tick', () => {
      link.attr('d', d => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        return 'M' + d.source.x + ',' + d.source.y + ' L' + d.target.x + ',' + d.target.y;
      });

      node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
    });
  </script>
</body>
</html>`;
  }
}
