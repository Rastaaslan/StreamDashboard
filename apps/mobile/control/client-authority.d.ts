export interface ClientAuthorityPeer {
  id: string;
  endpoint?: string;
  enabled?: boolean;
  roles?: string[];
}
export interface ClientAuthorityInstallation {
  runtimeProfile?: string;
  localDeviceId?: string;
  routes?: {obs?: string};
  devices?: ClientAuthorityPeer[];
}
export declare function clientAuthorityEndpoint(
  installation: ClientAuthorityInstallation | null | undefined
): string;
export declare function clientMustDelegateCommand(
  clientRole: boolean,
  path: string,
  body: {type?: string} | null | undefined
): boolean;
