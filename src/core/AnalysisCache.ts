/**
 * AnalysisCache - 增量分析缓存
 *
 * 缓存符号分析结果，检测文件变更，只重新分析受影响的部分
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ReferenceInfo, SymbolInfo } from './SymbolAnalyzer.js';

export interface CacheEntry {
  symbolName: string;
  file: string;
  timestamp: number;
  fileHash: string;
  references: ReferenceInfo[];
  symbolInfo: SymbolInfo | null;
}

export interface FileState {
  mtime: number;
  hash: string;
}

export class AnalysisCache {
  private cacheDir: string;
  private fileStates: Map<string, FileState> = new Map();
  private memoryCache: Map<string, CacheEntry> = new Map();

  constructor(projectRoot: string) {
    this.cacheDir = path.join(projectRoot, '.blast-radius-cache');
    this.ensureCacheDir();
    this.loadFileStates();
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private loadFileStates(): void {
    const stateFile = path.join(this.cacheDir, 'file-states.json');
    if (fs.existsSync(stateFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        for (const [key, value] of Object.entries(data)) {
          this.fileStates.set(key, value as FileState);
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  private saveFileStates(): void {
    const stateFile = path.join(this.cacheDir, 'file-states.json');
    const data: Record<string, FileState> = {};
    for (const [key, value] of this.fileStates) {
      data[key] = value;
    }
    fs.writeFileSync(stateFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  private computeFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    // 简单的哈希计算
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * 检测文件是否有变更
   */
  hasFileChanged(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
      return true;
    }

    const stat = fs.statSync(filePath);
    const currentMtime = stat.mtimeMs;
    const currentHash = this.computeFileHash(filePath);

    const saved = this.fileStates.get(filePath);
    if (!saved) {
      return true;
    }

    return saved.hash !== currentHash || saved.mtime !== currentMtime;
  }

  /**
   * 获取所有变更的文件
   */
  getChangedFiles(filePaths: string[]): string[] {
    return filePaths.filter(f => this.hasFileChanged(f));
  }

  /**
   * 更新文件状态
   */
  updateFileState(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      this.fileStates.delete(filePath);
      return;
    }

    const stat = fs.statSync(filePath);
    this.fileStates.set(filePath, {
      mtime: stat.mtimeMs,
      hash: this.computeFileHash(filePath),
    });
    this.saveFileStates();
  }

  /**
   * 获取缓存的引用结果
   */
  getCachedReferences(symbolName: string, file: string): CacheEntry | null {
    const key = `${file}:${symbolName}`;
    return this.memoryCache.get(key) || null;
  }

  /**
   * 缓存引用结果
   */
  cacheReferences(symbolName: string, file: string, symbolInfo: SymbolInfo | null, references: ReferenceInfo[]): void {
    const key = `${file}:${symbolName}`;
    this.memoryCache.set(key, {
      symbolName,
      file,
      timestamp: Date.now(),
      fileHash: this.computeFileHash(file),
      references,
      symbolInfo,
    });

    // 同时持久化到磁盘
    const cacheFile = path.join(this.cacheDir, `${Buffer.from(key).toString('base64url')}.json`);
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({
        symbolName,
        file,
        timestamp: Date.now(),
        references,
        symbolInfo: symbolInfo ? {
          name: symbolInfo.name,
          kind: symbolInfo.kind,
          file: symbolInfo.file,
          line: symbolInfo.line,
        } : null,
      }, null, 2), 'utf-8');
    } catch {
      // 忽略缓存写入错误
    }
  }

  /**
   * 清除缓存
   */
  clear(): void {
    this.memoryCache.clear();
    this.fileStates.clear();
    this.saveFileStates();

    // 清除缓存文件
    const files = fs.readdirSync(this.cacheDir);
    for (const file of files) {
      if (file.endsWith('.json') && file !== 'file-states.json') {
        fs.unlinkSync(path.join(this.cacheDir, file));
      }
    }
  }

  /**
   * 获取缓存统计
   */
  getStats(): { entries: number; files: number } {
    return {
      entries: this.memoryCache.size,
      files: this.fileStates.size,
    };
  }
}
