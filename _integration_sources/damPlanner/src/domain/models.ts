import { z } from 'zod';

export const providerSchema = z.enum(['GOOGLE', 'TWITCH']);
export type Provider = z.infer<typeof providerSchema>;

export const publicationStatusSchema = z.enum([
  'NOT_REQUESTED',
  'PENDING',
  'PUBLISHING',
  'SYNCED',
  'ERROR',
  'REAUTH_REQUIRED',
  'REMOTE_MISSING',
  'DELETED',
]);
export type PublicationStatus = z.infer<typeof publicationStatusSchema>;

const eventBaseSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['LIVE', 'PERSONAL']),
  title: z.string().trim().min(1),
  description: z.string().default(''),
  startAtUtc: z.string().datetime(),
  endAtUtc: z.string().datetime(),
  timezone: z.string().default('Europe/Paris'),
  syncGoogle: z.boolean(),
  syncTwitch: z.boolean(),
  googleCalendarId: z.string().nullable().default(null),
  twitchTitle: z.string().nullable().default(null),
  twitchCategoryId: z.string().nullable().default(null),
  twitchCategoryName: z.string().nullable().default(null),
  twitchCategoryBoxArtUrl: z.string().nullable().default(null),
  conflictOverrideHash: z.string().nullable().default(null),
  conflictOverrideAt: z.string().datetime().nullable().default(null),
  status: z.enum(['DRAFT','PUBLISHED']).default('PUBLISHED'),
  bufferBeforeMinutes: z.number().int().min(0).max(1440).nullable().default(null),
  bufferAfterMinutes: z.number().int().min(0).max(1440).nullable().default(null),
  checklist: z.array(z.object({id:z.string(),label:z.string().min(1),done:z.boolean()})).default([]),
  recurrence: z.object({frequency:z.enum(['DAILY','WEEKLY']),interval:z.number().int().min(1).max(365),weekdays:z.array(z.number().int().min(1).max(7)).default([]),until:z.string().datetime().nullable().default(null),count:z.number().int().min(1).max(500).nullable().default(null)}).nullable().default(null),
  lifecycleState: z.enum(['PLANNED','PREPARING','READY','LIVE','FINISHED','CANCELLED']).default('PLANNED'),
  actualStartAt: z.string().datetime().nullable().default(null),
  actualEndAt: z.string().datetime().nullable().default(null),
  routineId: z.string().uuid().nullable().default(null),
  routineSteps: z.array(z.object({id:z.string().uuid(),type:z.enum(['CHECK','OPEN_APP','OPEN_URL','OPEN_FILE','LOCAL_HTTP','SEPARATOR','TEXT']),phase:z.enum(['BEFORE','DURING','AFTER']),label:z.string(),targetId:z.string().uuid().nullable().default(null),done:z.boolean().default(false)})).default([]),
  tags: z.array(z.string()).default([]),
  participantIds: z.array(z.string().uuid()).default([]),
  travelBeforeMinutes: z.number().int().min(0).max(1440).default(0),
  travelAfterMinutes: z.number().int().min(0).max(1440).default(0),
  postLiveMood: z.enum(['SAD','NEUTRAL','GOOD','FIRE']).nullable().default(null),
  postLiveNote: z.string().max(10_000).default(''),
  highlights: z.array(z.object({id:z.string().uuid(),type:z.enum(['CLIP','BUG','IDEA','REPLAY']),text:z.string().max(1000)})).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().default(null),
});

type EventRefinementValue = {
  startAtUtc: string;
  endAtUtc: string;
  syncTwitch: boolean;
  twitchTitle: string | null;
  twitchCategoryId: string | null;
};

function refineEvent(value: EventRefinementValue, context: z.RefinementCtx) {
  if (new Date(value.endAtUtc) <= new Date(value.startAtUtc)) {
    context.addIssue({
      code: 'custom',
      message: 'La fin doit suivre le début',
      path: ['endAtUtc'],
    });
  }

  if (!value.syncTwitch) return;

  if (!value.twitchTitle || !value.twitchCategoryId) {
    context.addIssue({
      code: 'custom',
      message: 'Titre public et catégorie Twitch requis',
      path: ['twitchTitle'],
    });
  }

  const minutes = (Date.parse(value.endAtUtc) - Date.parse(value.startAtUtc)) / 60_000;
  if (minutes < 30 || minutes > 1380) {
    context.addIssue({
      code: 'custom',
      message: 'Un segment Twitch doit durer entre 30 minutes et 23 heures',
      path: ['endAtUtc'],
    });
  }

  if ((value.twitchTitle?.length ?? 0) > 140) {
    context.addIssue({
      code: 'custom',
      message: 'Le titre Twitch est limité à 140 caractères',
      path: ['twitchTitle'],
    });
  }
}

export const eventSchema = eventBaseSchema.superRefine(refineEvent);
// Input typing keeps additive fields optional for records created before the
// daily-hub migration; parsing still materialises every default at runtime.
export type PlannerEvent = z.input<typeof eventSchema>;

export interface EventPublication {
  eventId: string;
  provider: Provider;
  status: PublicationStatus;
  externalId: string | null;
  lastError: string | null;
  payloadHash: string | null;
  lastSyncedAt: string | null;
}

export interface SyncAttempt {
  id: string;
  eventId: string;
  provider: Provider;
  operation: string;
  status: string;
  error: string | null;
  createdAt: string;
}

export const eventInputSchema = eventBaseSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
    conflictOverrideHash: true,
    conflictOverrideAt: true,
  })
  .superRefine(refineEvent);

export type EventInput = z.input<typeof eventInputSchema>;

export const routineStepSchema=z.object({id:z.string().uuid(),type:z.enum(['CHECK','OPEN_APP','OPEN_URL','OPEN_FILE','LOCAL_HTTP','SEPARATOR','TEXT']),phase:z.enum(['BEFORE','DURING','AFTER']),label:z.string().trim().min(1).max(200),targetId:z.string().uuid().nullable().default(null)});
export const liveRoutineSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),steps:z.array(routineStepSchema).max(100),createdAt:z.string().datetime(),updatedAt:z.string().datetime()});export type LiveRoutine=z.infer<typeof liveRoutineSchema>;
export const participantSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),alias:z.string().max(100).default(''),notes:z.string().max(2000).default('')});export type Participant=z.infer<typeof participantSchema>;
export const tagSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(50),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null)});export type EventTag=z.infer<typeof tagSchema>;
export const localActionTargetSchema=z.discriminatedUnion('type',[z.object({id:z.string().uuid(),name:z.string().min(1).max(100),type:z.literal('OPEN_APP'),path:z.string().min(1).max(4096),enabled:z.boolean()}),z.object({id:z.string().uuid(),name:z.string().min(1).max(100),type:z.literal('OPEN_FILE'),path:z.string().min(1).max(4096),enabled:z.boolean()}),z.object({id:z.string().uuid(),name:z.string().min(1).max(100),type:z.literal('OPEN_URL'),url:z.string().url(),enabled:z.boolean()}),z.object({id:z.string().uuid(),name:z.string().min(1).max(100),type:z.literal('LOCAL_HTTP'),url:z.string().url(),method:z.enum(['GET','POST']),enabled:z.boolean()})]);export type LocalActionTarget=z.infer<typeof localActionTargetSchema>;
export const templateSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1),kind:z.enum(['LIVE','PERSONAL']),durationMinutes:z.number().int().min(1).max(1440),description:z.string().default(''),syncGoogle:z.boolean().default(false),syncTwitch:z.boolean().default(false),twitchTitle:z.string().nullable().default(null),twitchCategoryId:z.string().nullable().default(null),twitchCategoryName:z.string().nullable().default(null),bufferBeforeMinutes:z.number().int().min(0).nullable().default(null),bufferAfterMinutes:z.number().int().min(0).nullable().default(null),checklist:z.array(z.string().min(1)).default([]),routineId:z.string().uuid().nullable().default(null),tags:z.array(z.string()).default([]),participantIds:z.array(z.string().uuid()).default([]),reminderMinutes:z.number().int().min(0).max(1440).nullable().default(null),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null)});
export type EventTemplate=z.infer<typeof templateSchema>;
