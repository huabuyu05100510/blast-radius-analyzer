/**
 * AnalysisCache - 增量分析缓存
 *
 * 缓存符号分析结果，检测文件变更，只重新分析受影响的部分
 */
import * as fs from 'fs';
import * as path from 'path';
export class AnalysisCache {
    cacheDir;
    fileStates = new Map();
    memoryCache = new Map();
    constructor(projectRoot) {
        this.cacheDir = path.join(projectRoot, '.blast-radius-cache');
        this.ensureCacheDir();
        this.loadFileStates();
    }
    ensureCacheDir() {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }
    loadFileStates() {
        const stateFile = path.join(this.cacheDir, 'file-states.json');
        if (fs.existsSync(stateFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
                for (const [key, value] of Object.entries(data)) {
                    this.fileStates.set(key, value);
                }
            }
            catch {
                // 忽略解析错误
            }
        }
    }
    saveFileStates() {
        const stateFile = path.join(this.cacheDir, 'file-states.json');
        const data = {};
        for (const [key, value] of this.fileStates) {
            data[key] = value;
        }
        fs.writeFileSync(stateFile, JSON.stringify(data, null, 2), 'utf-8');
    }
    computeFileHash(filePath) {
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
    hasFileChanged(filePath) {
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
    getChangedFiles(filePaths) {
        return filePaths.filter(f => this.hasFileChanged(f));
    }
    /**
     * 更新文件状态
     */
    updateFileState(filePath) {
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
    getCachedReferences(symbolName, file) {
        const key = `${file}:${symbolName}`;
        return this.memoryCache.get(key) || null;
    }
    /**
     * 缓存引用结果
     */
    cacheReferences(symbolName, file, symbolInfo, references) {
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
        }
        catch {
            // 忽略缓存写入错误
        }
    }
    /**
     * 清除缓存
     */
    clear() {
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
    getStats() {
        return {
            entries: this.memoryCache.size,
            files: this.fileStates.size,
        };
    }
}
