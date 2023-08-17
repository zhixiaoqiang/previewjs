import type { ErrorPayload, UpdatePayload } from "vite/types/hmrPayload";
import type { AppToPreviewMessage, PreviewToAppMessage } from "./messages";

export function createController(options: {
  getIframe: () => HTMLIFrameElement | null;
  listener(event: PreviewEvent): void;
}): PreviewIframeController {
  return new PreviewIframeControllerImpl(options);
}

export interface PreviewIframeController {
  start(): void;
  stop(): void;
  load(options: LoadPreviewOptions): void;
  resetIframe(id: string): void;
}

export interface LoadPreviewOptions {
  previewableId: string;
  propsAssignmentSource: string;
  autogenCallbackPropsSource: string;
}

class PreviewIframeControllerImpl implements PreviewIframeController {
  private idBootstrapped: string | null = null;
  private pendingPreviewableIdBootstrap: string | null = null;
  private lastMessage: AppToPreviewMessage | null = null;
  private expectRenderTimeout?: any;

  constructor(
    private readonly options: {
      getIframe: () => HTMLIFrameElement | null;
      listener(event: PreviewEvent): void;
    }
  ) {}

  start() {
    window.addEventListener("message", this.onWindowMessage);
  }

  stop() {
    window.removeEventListener("message", this.onWindowMessage);
  }

  load(options: LoadPreviewOptions) {
    this.send({
      kind: "render",
      ...options,
    });
  }

  private send(message: AppToPreviewMessage) {
    this.lastMessage = message;
    if (
      this.idBootstrapped !== message.previewableId &&
      this.pendingPreviewableIdBootstrap !== message.previewableId
    ) {
      this.resetIframe(message.previewableId);
      return;
    }
    const iframeWindow = this.options.getIframe()?.contentWindow;
    if (!iframeWindow) {
      return;
    }
    iframeWindow.postMessage(message, document.location.href);
    if (message.kind === "render") {
      this.clearExpectRenderTimeout();
      this.expectRenderTimeout = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.warn(
          "Expected render did not occur after 5 seconds. Reloading iframe..."
        );
        this.resetIframe(message.previewableId);
      }, 5000);
    }
  }

  resetIframe(id: string) {
    const iframe = this.options.getIframe();
    this.idBootstrapped = null;
    if (!iframe) {
      return;
    }
    this.pendingPreviewableIdBootstrap = id;
    iframe.src = `/preview/${id}/?t=${Date.now()}`;
  }

  private onWindowMessage = (event: MessageEvent<PreviewToAppMessage>) => {
    const data = event.data;
    const { listener } = this.options;
    switch (data.kind) {
      case "bootstrapped":
        this.onBootstrapped();
        break;
      case "before-render":
      case "action":
      case "log-message":
      case "file-changed":
        listener(data);
        break;
      case "rendering-setup":
        listener({
          kind: "rendering-setup",
        });
        break;
      case "rendering-success":
        this.clearExpectRenderTimeout();
        listener({
          kind: "rendering-done",
          success: true,
        });
        break;
      case "rendering-error":
        this.clearExpectRenderTimeout();
        listener({
          kind: "log-message",
          level: "error",
          timestamp: Date.now(),
          message: data.message,
        });
        listener({
          kind: "rendering-done",
          success: false,
        });
        break;
      case "vite-error":
        listener({
          kind: "log-message",
          level: "error",
          timestamp: Date.now(),
          message: generateMessageFromViteError(data.payload.err),
        });
        break;
      case "vite-before-update":
        listener({
          kind: "before-vite-update",
          payload: data.payload,
        });
        break;
    }
  };

  private onBootstrapped() {
    this.idBootstrapped = this.pendingPreviewableIdBootstrap;
    this.pendingPreviewableIdBootstrap = null;
    if (this.lastMessage) {
      this.send(this.lastMessage);
    }
    this.options.listener({
      kind: "bootstrapped",
    });
  }

  private clearExpectRenderTimeout() {
    if (this.expectRenderTimeout) {
      clearTimeout(this.expectRenderTimeout);
      this.expectRenderTimeout = null;
    }
  }
}

function generateMessageFromViteError(err: ErrorPayload["err"]) {
  let message = err.message + (err.stack ? `\n${err.stack}` : "");
  // Remove any redundant line breaks (but not spaces,
  // which could be useful indentation).
  message = message.replace(/^\n+/g, "\n").trim();
  const stripPrefix = "Internal server error: ";
  if (message.startsWith(stripPrefix)) {
    message = message.substr(stripPrefix.length);
  }
  if (/^Transform failed with \d+ errors?:?\n.*/.test(message)) {
    const lineBreakPosition = message.indexOf("\n");
    message = message.substring(lineBreakPosition + 1);
  }
  const lineBreakPosition = message.indexOf("\n");
  let title: string;
  let rest: string;
  if (lineBreakPosition > -1) {
    title = message.substr(0, lineBreakPosition).trim();
    rest = message.substr(lineBreakPosition + 1);
  } else {
    title = message;
    rest = "";
  }
  if (title.endsWith(":") || title.endsWith(".")) {
    title = title.substr(0, title.length - 1).trim();
  }
  // Note: this isn't relevant to all browsers.
  if (rest.startsWith(`Error: ${title}\n`)) {
    rest = rest.substr(rest.indexOf("\n") + 1);
  }
  return `${title}${rest ? `\n\n${rest}` : ""}`;
}

export type PreviewEvent =
  | PreviewBootstrapped
  | BeforeViteUpdate
  | BeforeRender
  | RenderingSetup
  | RenderingDone
  | Action
  | LogMessage
  | FileChanged;

export type PreviewBootstrapped = {
  kind: "bootstrapped";
};

export type BeforeViteUpdate = {
  kind: "before-vite-update";
  payload: UpdatePayload;
};

export type BeforeRender = {
  kind: "before-render";
};

export type RenderingSetup = {
  kind: "rendering-setup";
};

export interface RenderingDone {
  kind: "rendering-done";
  success: boolean;
}

export interface Action {
  kind: "action";
  type: "fn" | "url";
  path: string;
}

export interface LogMessage {
  kind: "log-message";
  timestamp: number;
  level: LogLevel;
  message: string;
}

export type LogLevel = "log" | "info" | "warn" | "error";

export interface FileChanged {
  kind: "file-changed";
  path: string;
}

export type RendererLoader = (options: {
  wrapperModule: any;
  wrapperName?: string;
  previewableModule: any;
  id: string;
  renderId: number;
  shouldAbortRender: () => boolean;
}) => Promise<{
  render: (getProps: GetPropsFn) => Promise<void>;
  // Note: we use `any` here because it depends on the framework.
  // This will be null if JSX isn't supported.
  jsxFactory: ((type: any, props: any, ...children: any[]) => any) | null;
}>;

export type GetPropsFn = (options: {
  presetGlobalProps: any;
  presetProps: any;
}) => Record<string, any>;
