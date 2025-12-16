import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    version: string;
}

export class CacheManager {
    private cacheDir: string;
    private projectPath: string | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.cacheDir = path.join(context.globalStorageUri.fsPath, 'unreal-cache');
        this.ensureCacheDir();
    }

    private ensureCacheDir(): void {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    setProjectPath(projectPath: string): void {
        this.projectPath = projectPath;
    }

    private getCacheFilePath(key: string): string {
        // Include project path in cache key to avoid conflicts
        const projectHash = this.projectPath ? 
            Buffer.from(this.projectPath).toString('base64').replace(/[/+=]/g, '_').substring(0, 16) : 
            'default';
        return path.join(this.cacheDir, `${projectHash}_${key}.json`);
    }

    get<T>(key: string, maxAgeMs: number = 3600000): T | null {
        const cacheFile = this.getCacheFilePath(key);
        
        if (!fs.existsSync(cacheFile)) {
            return null;
        }

        try {
            const content = fs.readFileSync(cacheFile, 'utf-8');
            const entry: CacheEntry<T> = JSON.parse(content);
            
            const age = Date.now() - entry.timestamp;
            if (age > maxAgeMs) {
                // Cache expired
                fs.unlinkSync(cacheFile);
                return null;
            }

            return entry.data;
        } catch (error) {
            // Cache file corrupted, delete it
            try {
                fs.unlinkSync(cacheFile);
            } catch {
                // Ignore deletion errors
            }
            return null;
        }
    }

    set<T>(key: string, data: T): void {
        const cacheFile = this.getCacheFilePath(key);
        
        const entry: CacheEntry<T> = {
            data,
            timestamp: Date.now(),
            version: '1.0'
        };

        try {
            fs.writeFileSync(cacheFile, JSON.stringify(entry, null, 2), 'utf-8');
        } catch (error) {
            // Ignore write errors
            console.error(`Failed to write cache file ${cacheFile}:`, error);
        }
    }

    invalidate(key: string): void {
        const cacheFile = this.getCacheFilePath(key);
        if (fs.existsSync(cacheFile)) {
            try {
                fs.unlinkSync(cacheFile);
            } catch {
                // Ignore deletion errors
            }
        }
    }

    clear(): void {
        if (fs.existsSync(this.cacheDir)) {
            try {
                const files = fs.readdirSync(this.cacheDir);
                for (const file of files) {
                    const filePath = path.join(this.cacheDir, file);
                    try {
                        fs.unlinkSync(filePath);
                    } catch {
                        // Ignore deletion errors
                    }
                }
            } catch {
                // Ignore read errors
            }
        }
    }

    getCacheStats(): { size: number; files: string[] } {
        if (!fs.existsSync(this.cacheDir)) {
            return { size: 0, files: [] };
        }

        try {
            const files = fs.readdirSync(this.cacheDir);
            let totalSize = 0;
            for (const file of files) {
                const filePath = path.join(this.cacheDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    totalSize += stats.size;
                } catch {
                    // Ignore stat errors
                }
            }
            return { size: totalSize, files };
        } catch {
            return { size: 0, files: [] };
        }
    }
}

