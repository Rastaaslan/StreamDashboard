export declare const settingsStorage: {
  getServer(): string;
  setServer(value: string): void;
};

export declare const credentialStorage: {
  get(): Promise<string>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
};
