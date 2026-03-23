declare module "@tloncorp/api" {
  export type ConfigureClientParams = {
    shipName: string;
    shipUrl: string;
    verbose?: boolean;
    fetchFn?: typeof fetch;
    getCode?: () => string | Promise<string>;
    handleAuthFailure?: ((...args: unknown[]) => void) | undefined;
    onQuitOrReset?: ((reason: "quit" | "reset") => void) | undefined;
    onChannelStatusChange?: ((status: string) => void) | undefined;
    client?: unknown;
  };

  export function configureClient(params: ConfigureClientParams): Promise<void>;

  export type UploadFileParams = {
    blob: Blob;
    fileName?: string;
    contentType?: string;
  };

  export type UploadResult = {
    url: string;
  };

  export function uploadFile(params: UploadFileParams): Promise<UploadResult>;
}
