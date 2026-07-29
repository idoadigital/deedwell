import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Object-storage seam. Production uses an S3-compatible adapter (Hetzner
 * Object Storage) implementing this same interface; dev/tests use the local
 * filesystem. Keys are always server-generated and tenant-prefixed.
 */
export interface StorageAdapter {
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class LocalFsStorage implements StorageAdapter {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    if (key.includes("..") || path.isAbsolute(key)) {
      throw new Error("Invalid storage key");
    }
    return path.join(this.rootDir, key);
  }

  async put(key: string, content: Buffer): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}

export function tenantFileKey(tenantId: string, fileId: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  return `tenants/${tenantId}/files/${fileId}/${safeName}`;
}
