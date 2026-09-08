import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export const settingsSchema = z.object({
  timezone: z.string().default('Europe/Paris'),
  googleDefaultCalendarId: z.string().default('primary'),
  googleDisplayCalendarIds: z.array(z.string()).default(['primary']),
  googleAvailabilityCalendarIds: z.array(z.string()).default(['primary']),
  twitchClientId: z.string().default(''),
  availabilityLocal: z.boolean().default(true),
  availabilityGoogle: z.boolean().default(true),
  availabilityTwitch: z.boolean().default(true),
  onboardingDone: z.boolean().default(false),
  refreshMinutes: z.union([z.literal(0),z.literal(5),z.literal(15),z.literal(30)]).default(15),
  liveBufferBefore: z.number().int().min(0).max(240).default(30),
  liveBufferAfter: z.number().int().min(0).max(240).default(15),
  personalBufferBefore: z.number().int().min(0).max(240).default(0),
  personalBufferAfter: z.number().int().min(0).max(240).default(0),
  notificationsEnabled: z.boolean().default(true),
  liveReminderMinutes: z.number().int().min(0).max(1440).default(30),
  personalReminderMinutes: z.number().int().min(0).max(1440).default(60),
  closeToTray: z.boolean().default(false),
  launchAtStartup: z.boolean().default(false),
});
export type AppSettings = z.infer<typeof settingsSchema>;

export class SettingsStore {
  constructor(private readonly path: string) {}
  async get(): Promise<AppSettings> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>;
      if (!Array.isArray(raw.googleDisplayCalendarIds)) {
        raw.googleDisplayCalendarIds = Array.isArray(raw.googleAvailabilityCalendarIds) ? raw.googleAvailabilityCalendarIds : ['primary'];
      }
      return settingsSchema.parse(raw);
    } catch { return settingsSchema.parse({}); }
  }
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const value = settingsSchema.parse({ ...(await this.get()), ...patch });
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(value, null, 2), { mode: 0o600 });
    return value;
  }
}
