import {ACTIONS,ACTION_TYPES,ACTION_LIMITS} from './action-registry.js';
const types=new Set(ACTION_TYPES);
// Fields that determine a side effect. Presentation and shortcut changes do not
// change its meaning; device, target action and parameters always do.
/** @param {any} value */
export function actionDefinition(value) {
  if (!value || typeof value.id !== 'string' || typeof value.type !== 'string' || typeof value.value !== 'string' || value.value.length > ACTION_LIMITS.value || !types.has(value.type) || (!/^[A-Za-z0-9_-]+$/.test(value.id)||value.id.length>ACTION_LIMITS.id)) return null;
  return JSON.stringify([value.id, value.type, value.value, value.wizebot?.channel || '', value.wizebot?.id || '']);
}
/** @param {keyof typeof ACTIONS} type */
export function actionCapability(type) { return ACTIONS[type]?.capability || 'obs'; }
