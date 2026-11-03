import type { RequestHandler } from 'express';

/** Explicit production boundary. Development/lab code remains in source for V4. */
export const streamCockpitReleaseScope = Object.freeze({
  version: '3.0',
  clipForge: Object.freeze({ enabled: false, deferredTo: '4.0' }),
  modularLayout: Object.freeze({ enabled: false, deferredTo: '3.1' }),
});

/** Mounted under /api after origin validation; never imports a media executor. */
export const enforceStreamCockpitReleaseScope: RequestHandler = (request, response, next) => {
  let path: string;
  try { path = decodeURIComponent(request.path).toLowerCase(); }
  catch { response.status(400).json({ error: { code: 'INVALID_API_PATH', retryable: false } }); return; }
  const route = /^(?:\/v[12])?\/(?:streamcockpit-)?clipforge(?:\/|$)/.test(path);
  const command = ['/v2/actions', '/v1/commands', '/commands'].includes(path) &&
    ['action', 'type', 'command'].some(key =>
      typeof request.body?.[key] === 'string' &&
      /^(?:clipforge|media\.render|video\.export)(?:[.:-]|$)/i.test(request.body[key]));
  if (!route && !command) { next(); return; }
  response.set('Cache-Control', 'no-store').status(410).json({
    error: {
      code: 'FEATURE_DEFERRED',
      message: 'ClipForge et le montage vidéo sont prévus en version 4.',
      retryable: false,
      feature: 'CLIPFORGE', targetVersion: '4.0',
    },
  });
};
