import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultProductProfile, exportProductProfile, importProductProfile, type ProductProfile } from '../../../packages/core/src/product-profile.js';
export class ProductProfileStore {
  constructor(readonly file: string) {}
  async load(migrate?: (profile: ProductProfile) => ProductProfile): Promise<ProductProfile> { try { const profile = importProductProfile(await readFile(this.file, 'utf8')); return migrate ? migrate(profile) : profile; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { const profile = defaultProductProfile(); await this.save(profile); return profile; } await rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => undefined); const profile = defaultProductProfile(); await this.save(profile); return profile; } }
  async save(profile: ProductProfile): Promise<void> { const content = exportProductProfile(profile); await mkdir(path.dirname(this.file), { recursive: true }); const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`; const handle = await open(temp, 'wx'); try { await handle.writeFile(content); await handle.sync(); await handle.close(); await rename(temp, this.file); } catch (error) { await handle.close().catch(() => undefined); await unlink(temp).catch(() => undefined); throw error; } }
  async import(source: string): Promise<{ profile: ProductProfile; backup: string | null }> { const profile = importProductProfile(source); let backup: string | null = null; try { await readFile(this.file); backup = `${this.file}.backup-${Date.now()}`; await copyFile(this.file, backup); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } try { await this.save(profile); return { profile, backup }; } catch (error) { if (backup) await copyFile(backup, this.file).catch(() => undefined); throw error; } }
  async export(): Promise<string> { return exportProductProfile(await this.load()); }
}
