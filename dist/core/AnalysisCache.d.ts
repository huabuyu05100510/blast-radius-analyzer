/**
 * AnalysisCache - 增量分析缓存
 *
 * 缓存符号分析结果，检测文件变更，只重新分析受影响的部分
 */
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
export declare class AnalysisCache {
    private cacheDir;
    private fileStates;
    private memoryCache;
    constructor(projectRoot: string);
    private ensureCacheDir;
    private loadFileStates;
    private saveFileStates;
    private computeFileHash;
    /**
     * 检测文件是否有变更
     */
    hasFileChanged(filePath: string): boolean;
    /**
     * 获取所有变更的文件
     */
    getChangedFiles(filePaths: string[]): string[];
    /**
     * 更新文件状态
     */
    updateFileState(filePath: string): void;
    /**
     * 获取缓存的引用结果
     */
    getCachedReferences(symbolName: string, file: string): CacheEntry | null;
    /**
     * 缓存引用结果
     */
    cacheReferences(symbolName: string, file: string, symbolInfo: SymbolInfo | null, references: ReferenceInfo[]): void;
    /**
     * 清除缓存
     */
    clear(): void;
    /**
     * 获取缓存统计
     */
    getStats(): {
        entries: number;
        files: number;
    };
}
