import type { DeckAction } from '../../../packages/contracts/src/control.js';
export interface ActionRoute { workspace:string; actionId:string; deviceId:string; definition:DeckAction }
export type DeviceRole = 'controller' | 'obs-executor' | 'display' | 'services' | 'audio';
export interface InstallationDevice { id: string; name: string; platform: 'windows'|'android'|'browser'; roles: DeviceRole[]; capabilities: string[]; enabled: boolean; endpoint?: string }
export interface Installation { version: 2; revision: number; localDeviceId: string; preset: string; runtimeProfile: 'root'|'device-runtime'|'native'|'browser'; configured: boolean; background: boolean; startAtLogin?: boolean; devices: InstallationDevice[]; actionRoutes?: ActionRoute[]; routes: Record<string,string>; [key:string]: unknown }
export interface InstallationChanges { restore?: unknown; preset?: string; name?: string; roles?: DeviceRole[]; background?: boolean; startAtLogin?: boolean; routes?: Record<string,string>; actionRoutes?: ActionRoute[]; device?: InstallationDevice; disableDeviceId?: string }
export interface InstallationPlan { next: Installation; restart: boolean; summary: string[] }
export const SETUPS: Readonly<Record<string,string>>;
export const ROLES: Readonly<Record<DeviceRole,string>>;
export function roleForCapability(capability: string): DeviceRole | undefined;
export function deviceRoleAvailable(device: InstallationDevice, capability: string): boolean;
export function installationRequiresRestart(before: Installation, after: Installation): boolean;
export function capabilitiesFor(platform: string): string[];
export function installationEndpoint(value: string): string;
export function validateInstallation(input: unknown): Installation;
export function migrateInstallation(options: {id: string; platform: string; legacy?: {name?:string;role?:string;configured?:boolean}; pairedEndpoint?:string}): Installation;
export function planInstallationChange(current: Installation, changes: InstallationChanges, expectedRevision: number): InstallationPlan;
export function resolveCapability(installation: Installation, capability: string, observations?: Record<string,{connected:boolean;obsConnected?:boolean;permissions?:string[];roles?:DeviceRole[]}>, targetId?: string): {status:string;reason:string;message:string;deviceId?:string};

export function publicInstallationDevice(device: InstallationDevice): InstallationDevice;
export function associateInstallationDevice(current: Installation, endpoint: string, advertised?: InstallationDevice): InstallationChanges;
export function installationBackup(current:Installation,now?:()=>string):{format:string;version:number;savedAt:string;installation:Installation};
export function readInstallationBackup(document:unknown,current:Installation):Installation;
