import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  defaultProductProfile,
  exportProductProfile,
  importProductProfile,
  type ProductProfile,
} from '../../../packages/core/src/product-profile.js';

export class ProductProfileStore {
  constructor(readonly file: string) {}

  async load(migrate?: (profile: ProductProfile) => ProductProfile): Promise<ProductProfile> {
    let source: string;
    try {
      source = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const profile = defaultProductProfile();
      await this.save(profile);
      return profile;
    }

    try {
      const profile = importProductProfile(source);
      return migrate ? migrate(profile) : profile;
    } catch {
      await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      const profile = defaultProductProfile();
      await this.save(profile);
      return profile;
    }
  }

  async save(profile: ProductProfile): Promise<void> {
    const content = exportProductProfile(profile);
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      await rename(temporary, this.file);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async import(source: string): Promise<{ profile: ProductProfile; backup: string | null }> {
    // Parse and validate before touching the canonical file.
    const profile = importProductProfile(source);
    let backup: string | null = null;
    try {
      await readFile(this.file);
      backup = `${this.file}.backup-${Date.now()}`;
      await copyFile(this.file, backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    try {
      await this.save(profile);
      return { profile, backup };
    } catch (error) {
      if (backup) await copyFile(backup, this.file).catch(() => undefined);
      throw error;
    }
  }

  async export(): Promise<string> {
    return exportProductProfile(await this.load());
  }
}
