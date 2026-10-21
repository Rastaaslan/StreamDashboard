export type DevicePermission = 'observe'|'obs'|'clips'|'audio'|'chat'|'cloud'|'planning'|'configuration';
export const DEVICE_PERMISSIONS: Readonly<Record<DevicePermission,string>>;
export function validateDevicePermissions(value: unknown): DevicePermission[];
