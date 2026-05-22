import type { EndpointPath } from "../config";
import WebSocket, { type RawData } from "ws";
import { readFile } from "node:fs/promises";

export interface CapturedResponse {
    endpointPath: EndpointPath;
    requestId: string;
    requestUrl: string;
    status: number;
    body: string;
}

interface JsonRpcRequest {
    id: number;
    method: string;
    params?: Record<string, unknown>;
    sessionId?: string;
}

interface JsonRpcSuccessResponse {
    id: number;
    result: Record<string, unknown>;
    sessionId?: string;
}

interface JsonRpcErrorResponse {
    id: number;
    error: {
        code: number;
        message: string;
    };
    sessionId?: string;
}

interface JsonRpcEvent {
    method: string;
    params?: Record<string, unknown>;
    sessionId?: string;
}

interface PendingCommand {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
}

interface TargetInfo {
    targetId: string;
    type: string;
}

interface NetworkResponseReceivedEvent {
    requestId: string;
    response: {
        url: string;
        status: number;
    };
}

interface NetworkRequestLifecycleEvent {
    requestId: string;
}

interface GetResponseBodyResult {
    body: string;
    base64Encoded?: boolean;
}

interface MatchedRequestResponse {
    endpointPath: EndpointPath;
    requestId: string;
    requestUrl: string;
    status: number;
    sessionId?: string;
}

export interface NetworkResponseLifecycleTracker {
    handleEvent(event: JsonRpcEvent): Promise<void>;
}

interface NetworkResponseLifecycleTrackerDependencies {
    enabledEndpointPaths: EndpointPath[];
    onCapturedResponse: (response: CapturedResponse) => Promise<void> | void;
    sendCommand: (
        method: string,
        params?: Record<string, unknown>,
        sessionId?: string
    ) => Promise<Record<string, unknown>>;
}

const CONNECT_RETRY_INTERVAL_MS = 250;
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Checks whether a value is a non-null object record.
 *
 * @param value Value to validate.
 * @returns True when the value is an object and not null.
 */
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/**
 * Parses the `Target.getTargets` result into strongly typed target entries.
 *
 * @param result Raw CDP command result.
 * @returns Parsed target list, or an empty list when the payload is invalid.
 */
function parseTargetInfos(result: Record<string, unknown>): TargetInfo[] {
    const rawTargets = result["targetInfos"];
    if (!Array.isArray(rawTargets)) {
        return [];
    }

    const targets: TargetInfo[] = [];
    for (const rawTarget of rawTargets) {
        if (!isObject(rawTarget)) {
            continue;
        }

        const targetId = rawTarget["targetId"];
        const type = rawTarget["type"];
        if (typeof targetId === "string" && typeof type === "string") {
            targets.push({ targetId, type });
        }
    }

    return targets;
}

/**
 * Extracts a page session id from a `Target.attachedToTarget` event.
 *
 * @param event CDP event payload.
 * @returns Session id for page targets, otherwise undefined.
 */
function parseAttachedToTargetSessionId(event: JsonRpcEvent): string | undefined {
    const params = event.params;
    if (!isObject(params)) {
        return undefined;
    }

    const sessionId = params["sessionId"];
    const targetInfo = params["targetInfo"];
    if (typeof sessionId !== "string" || !isObject(targetInfo)) {
        return undefined;
    }

    const type = targetInfo["type"];
    return type === "page" ? sessionId : undefined;
}

/**
 * Parses and validates the payload for `Network.responseReceived` events.
 *
 * @param event CDP event payload.
 * @returns Parsed network response details, or undefined when invalid.
 */
function parseNetworkResponseReceivedEvent(event: JsonRpcEvent): NetworkResponseReceivedEvent | undefined {
    if (!isObject(event.params)) {
        return undefined;
    }

    const requestId = event.params["requestId"];
    const response = event.params["response"];
    if (typeof requestId !== "string" || !isObject(response)) {
        return undefined;
    }

    const url = response["url"];
    const status = response["status"];
    if (typeof url !== "string" || typeof status !== "number") {
        return undefined;
    }

    return {
        requestId,
        response: {
            url,
            status
        }
    };
}

/**
 * Parses and validates request lifecycle event payloads.
 *
 * @param event CDP event payload.
 * @returns Parsed lifecycle event details, or undefined when invalid.
 */
function parseNetworkRequestLifecycleEvent(event: JsonRpcEvent): NetworkRequestLifecycleEvent | undefined {
    if (!isObject(event.params)) {
        return undefined;
    }

    const requestId = event.params["requestId"];
    if (typeof requestId !== "string") {
        return undefined;
    }

    return { requestId };
}

/**
 * Parses the result returned by `Network.getResponseBody`.
 *
 * @param result Raw CDP command result.
 * @returns Parsed response body descriptor, or undefined when invalid.
 */
function parseGetResponseBodyResult(result: Record<string, unknown>): GetResponseBodyResult | undefined {
    const body = result["body"];
    const base64Encoded = result["base64Encoded"];

    if (typeof body !== "string") {
        return undefined;
    }

    if (base64Encoded !== undefined && typeof base64Encoded !== "boolean") {
        return undefined;
    }

    if (base64Encoded === undefined) {
        return { body };
    }

    return {
        body,
        base64Encoded
    };
}

/**
 * Decodes a response body returned by CDP.
 *
 * @param result Parsed `Network.getResponseBody` result.
 * @returns UTF-8 decoded body text.
 */
function decodeResponseBody(result: GetResponseBodyResult): string {
    if (result.base64Encoded === true) {
        return Buffer.from(result.body, "base64").toString("utf8");
    }

    return result.body;
}

/**
 * Creates a stable key for request tracking across page sessions.
 *
 * @param requestId CDP request identifier.
 * @param sessionId CDP target session identifier.
 * @returns Combined request tracking key.
 */
function buildRequestKey(requestId: string, sessionId?: string): string {
    return `${sessionId ?? "__root__"}:${requestId}`;
}

/**
 * Creates a tracker that matches response events to loading completion events,
 * fetches response bodies once they are available, and forwards captured payloads.
 *
 * @param dependencies Tracker dependencies.
 * @returns Lifecycle tracker for a single listener instance.
 */
export function createNetworkResponseLifecycleTracker(
    dependencies: NetworkResponseLifecycleTrackerDependencies
): NetworkResponseLifecycleTracker {
    const matchedRequestResponses = new Map<string, MatchedRequestResponse>();

    const handleNetworkResponseReceived = (event: JsonRpcEvent): void => {
        const parsedEvent = parseNetworkResponseReceivedEvent(event);
        if (parsedEvent === undefined) {
            return;
        }

        const endpointPath = resolveEndpointPath(parsedEvent.response.url, dependencies.enabledEndpointPaths);
        if (endpointPath === undefined) {
            return;
        }

        const requestKey = buildRequestKey(parsedEvent.requestId, event.sessionId);
        const matchedResponse: MatchedRequestResponse = {
            endpointPath,
            requestId: parsedEvent.requestId,
            requestUrl: parsedEvent.response.url,
            status: parsedEvent.response.status
        };
        if (event.sessionId !== undefined) {
            matchedResponse.sessionId = event.sessionId;
        }

        matchedRequestResponses.set(requestKey, matchedResponse);
    };

    const handleNetworkLoadingFinished = async (event: JsonRpcEvent): Promise<void> => {
        const parsedEvent = parseNetworkRequestLifecycleEvent(event);
        if (parsedEvent === undefined) {
            return;
        }

        const requestKey = buildRequestKey(parsedEvent.requestId, event.sessionId);
        const matchedResponse = matchedRequestResponses.get(requestKey);
        if (matchedResponse === undefined) {
            return;
        }

        matchedRequestResponses.delete(requestKey);
        const result = await dependencies.sendCommand(
            "Network.getResponseBody",
            { requestId: matchedResponse.requestId },
            matchedResponse.sessionId
        );
        const parsedBody = parseGetResponseBodyResult(result);
        if (parsedBody === undefined) {
            return;
        }

        await dependencies.onCapturedResponse({
            endpointPath: matchedResponse.endpointPath,
            requestId: matchedResponse.requestId,
            requestUrl: matchedResponse.requestUrl,
            status: matchedResponse.status,
            body: decodeResponseBody(parsedBody)
        });
    };

    const handleNetworkLoadingFailed = (event: JsonRpcEvent): void => {
        const parsedEvent = parseNetworkRequestLifecycleEvent(event);
        if (parsedEvent === undefined) {
            return;
        }

        const requestKey = buildRequestKey(parsedEvent.requestId, event.sessionId);
        matchedRequestResponses.delete(requestKey);
    };

    return {
        async handleEvent(event: JsonRpcEvent): Promise<void> {
            if (event.method === "Network.responseReceived") {
                handleNetworkResponseReceived(event);
                return;
            }

            if (event.method === "Network.loadingFinished") {
                await handleNetworkLoadingFinished(event);
                return;
            }

            if (event.method === "Network.loadingFailed") {
                handleNetworkLoadingFailed(event);
            }
        }
    };
}

/**
 * Resolves which configured endpoint path matches a request URL.
 *
 * @param requestUrl Observed request URL.
 * @param enabledEndpointPaths Enabled endpoint path filters.
 * @returns Matching endpoint path, or undefined when no match exists.
 */
function resolveEndpointPath(requestUrl: string, enabledEndpointPaths: EndpointPath[]): EndpointPath | undefined {
    return enabledEndpointPaths.find((path) => requestUrl.includes(path));
}

/**
 * Converts raw websocket message payloads into UTF-8 strings.
 *
 * @param message Raw message from `ws`.
 * @returns Message text.
 */
function rawMessageToString(message: RawData): string {
    if (typeof message === "string") {
        return message;
    }

    if (Array.isArray(message)) {
        return Buffer.concat(message).toString("utf8");
    }

    if (message instanceof ArrayBuffer) {
        return Buffer.from(message).toString("utf8");
    }

    return message.toString("utf8");
}

/**
 * Reads the WSL host nameserver from `/etc/resolv.conf` when available.
 *
 * @returns Nameserver host IP when running under WSL, otherwise undefined.
 */
async function readWslNameserverHost(): Promise<string | undefined> {
    if (typeof process.env["WSL_INTEROP"] !== "string" || process.env["WSL_INTEROP"].trim() === "") {
        return undefined;
    }

    try {
        const resolvConf = await readFile("/etc/resolv.conf", "utf8");
        const nameserverLine = resolvConf
            .split(/\r?\n/)
            .find((line) => line.startsWith("nameserver "));
        const host = nameserverLine?.split(/\s+/)[1]?.trim();
        if (host !== undefined && host !== "") {
            return host;
        }
    } catch {
        // Ignore resolv.conf read failures.
    }

    return undefined;
}

/**
 * Builds a prioritized list of websocket endpoint URLs for connecting to Chrome DevTools.
 *
 * @param webSocketDebuggerUrl Original debugger endpoint URL.
 * @returns Candidate websocket URLs to try in order.
 */
async function buildWebSocketEndpointCandidates(webSocketDebuggerUrl: string): Promise<string[]> {
    const parsed = new URL(webSocketDebuggerUrl);
    const port = parsed.port;
    const protocol = parsed.protocol;
    const pathname = `${parsed.pathname}${parsed.search}`;
    const originalHost = parsed.hostname;

    const candidates = [originalHost, "127.0.0.1", "localhost"];
    const wslHost = await readWslNameserverHost();
    if (wslHost !== undefined) {
        candidates.push(wslHost);
    }

    const uniqueHosts = candidates.filter((value, index, arr) => arr.indexOf(value) === index);
    return uniqueHosts.map((host) => `${protocol}//${host}${port === "" ? "" : `:${port}`}${pathname}`);
}

/**
 * Opens a websocket connection to a Chrome DevTools endpoint.
 *
 * @param webSocketDebuggerUrl Endpoint URL.
 * @returns Connected websocket instance.
 */
async function connectWebSocket(webSocketDebuggerUrl: string): Promise<WebSocket> {
    return await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(webSocketDebuggerUrl);

        socket.once("open", () => {
            resolve(socket);
        });

        socket.once("error", (error: Error) => {
            socket.removeAllListeners();
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                socket.terminate();
            }
            reject(error);
        });
    });
}

/**
 * Type guard for JSON-RPC success responses.
 *
 * @param value Parsed websocket payload.
 * @returns True when payload has `id` and `result` fields.
 */
function isSuccessResponse(value: unknown): value is JsonRpcSuccessResponse {
    return (
        isObject(value) &&
        typeof value["id"] === "number" &&
        isObject(value["result"])
    );
}

/**
 * Type guard for JSON-RPC error responses.
 *
 * @param value Parsed websocket payload.
 * @returns True when payload has `id` and `error` fields.
 */
function isErrorResponse(value: unknown): value is JsonRpcErrorResponse {
    if (!isObject(value)) {
        return false;
    }

    const error = value["error"];
    return typeof value["id"] === "number" && isObject(error) && typeof error["message"] === "string";
}

/**
 * Type guard for JSON-RPC event messages.
 *
 * @param value Parsed websocket payload.
 * @returns True when payload looks like a CDP event.
 */
function isRpcEvent(value: unknown): value is JsonRpcEvent {
    return isObject(value) && typeof value["method"] === "string";
}

/**
 * Starts listening to Chrome DevTools network events and emits matched TikTok API responses.
 *
 * This function connects to the DevTools websocket, enables `Network` domain events
 * for page targets, captures `Network.responseReceived`, waits for
 * `Network.loadingFinished`, and fetches bodies for URLs matching enabled
 * endpoint paths.
 *
 * @param webSocketDebuggerUrl Chrome DevTools websocket URL.
 * @param enabledEndpointPaths Endpoint path filters to capture.
 * @param onCapturedResponse Callback invoked for each captured response.
 * @returns Async stop function that gracefully shuts down the listener.
 */
export async function startNetworkResponseListener(
    webSocketDebuggerUrl: string,
    enabledEndpointPaths: EndpointPath[],
    onCapturedResponse: (response: CapturedResponse) => Promise<void> | void
): Promise<() => Promise<void>> {
    let socket: WebSocket | undefined;
    let lastError: unknown;
    const startedAt = Date.now();

    while (Date.now() - startedAt < CONNECT_TIMEOUT_MS) {
        const endpointCandidates = await buildWebSocketEndpointCandidates(webSocketDebuggerUrl);

        for (const endpoint of endpointCandidates) {
            try {
                socket = await connectWebSocket(endpoint);
                break;
            } catch (error: unknown) {
                lastError = error;
            }
        }

        if (socket !== undefined) {
            break;
        }

        await new Promise((resolve) => {
            setTimeout(resolve, CONNECT_RETRY_INTERVAL_MS);
        });
    }

    if (socket === undefined) {
        const reason = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(`Failed to connect to Chrome DevTools websocket: ${reason}`);
    }

    const pendingCommands = new Map<number, PendingCommand>();
    const pageSessionIds = new Set<string>();
    let commandId = 0;

    /**
     * Sends a CDP command and resolves when a matching JSON-RPC response arrives.
     *
     * @param method CDP method name.
     * @param params Optional command parameters.
     * @param sessionId Optional target session id for session-scoped commands.
     * @returns Command result payload.
     */
    const sendCommand = async (
        method: string,
        params?: Record<string, unknown>,
        sessionId?: string
    ): Promise<Record<string, unknown>> => {
        commandId += 1;
        const id = commandId;

        const request: JsonRpcRequest = { id, method };
        if (params !== undefined) {
            request.params = params;
        }

        if (sessionId !== undefined) {
            request.sessionId = sessionId;
        }

        const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
            pendingCommands.set(id, { resolve, reject });
        });

        socket.send(JSON.stringify(request));
        return responsePromise;
    };

    const tracker = createNetworkResponseLifecycleTracker({
        enabledEndpointPaths,
        onCapturedResponse,
        sendCommand
    });

    /**
     * Rejects all in-flight commands and clears pending command state.
     *
     * @param error Error propagated to pending command promises.
     */
    const closeWithError = (error: Error): void => {
        for (const pending of pendingCommands.values()) {
            pending.reject(error);
        }
        pendingCommands.clear();
    };

    /**
     * Enables network domain events for a page session once per session id.
     *
     * @param sessionId Attached page session id.
     * @returns Resolves when `Network.enable` has been sent for that session.
     */
    const enableNetworkForSession = async (sessionId: string): Promise<void> => {
        if (pageSessionIds.has(sessionId)) {
            return;
        }

        pageSessionIds.add(sessionId);
        await sendCommand("Network.enable", {}, sessionId);
    };

    /**
     * Processes incoming websocket frames, routes JSON-RPC responses to pending
     * commands, and handles relevant CDP events for attach and network capture.
     */
    socket.on("message", (message: RawData) => {
        void (async () => {
            const data = rawMessageToString(message);
            // console.log("> data >", data);
            const payload = JSON.parse(data) as unknown;

            if (isSuccessResponse(payload)) {
                const pending = pendingCommands.get(payload.id);
                if (pending !== undefined) {
                    pendingCommands.delete(payload.id);
                    pending.resolve(payload.result);
                }
                return;
            }

            if (isErrorResponse(payload)) {
                const pending = pendingCommands.get(payload.id);
                if (pending !== undefined) {
                    pendingCommands.delete(payload.id);
                    const errorPayload = payload.error;
                    pending.reject(new Error(`CDP ${errorPayload.code}: ${errorPayload.message}`));
                }
                return;
            }

            if (!isRpcEvent(payload)) {
                return;
            }

            if (payload.method === "Target.attachedToTarget") {
                const sessionId = parseAttachedToTargetSessionId(payload);
                if (sessionId !== undefined) {
                    await enableNetworkForSession(sessionId);
                }
                return;
            }

            if (
                payload.method === "Network.responseReceived" ||
                payload.method === "Network.loadingFinished" ||
                payload.method === "Network.loadingFailed"
            ) {
                try {
                    await tracker.handleEvent(payload);
                } catch (error: unknown) {
                    const messageText = error instanceof Error ? error.message : String(error);
                    process.stderr.write(`Failed to process network event ${payload.method}: ${messageText}\n`);
                }
            }
        })().catch((error: unknown) => {
            const messageText = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Unhandled websocket message error: ${messageText}\n`);
        });
    });

    socket.on("close", () => {
        closeWithError(new Error("Chrome DevTools websocket connection closed."));
    });

    socket.on("error", (error: Error) => {
        closeWithError(new Error(`Chrome DevTools websocket connection error: ${error.message}`));
    });

    await sendCommand("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
    });

    const targetsResult = await sendCommand("Target.getTargets");
    const targets = parseTargetInfos(targetsResult);
    /**
     * Attaches to existing page targets and enables per-session network capture.
     */
    for (const target of targets) {
        if (target.type !== "page") {
            continue;
        }

        try {
            const attachResult = await sendCommand("Target.attachToTarget", {
                targetId: target.targetId,
                flatten: true
            });
            const attachedSessionId = attachResult["sessionId"];
            if (typeof attachedSessionId === "string") {
                await enableNetworkForSession(attachedSessionId);
            }
        } catch (error: unknown) {
            const messageText = error instanceof Error ? error.message : String(error);
            process.stderr.write(`Failed to attach to target ${target.targetId}: ${messageText}\n`);
        }
    }

    /**
     * Gracefully shuts down the network listener by rejecting pending commands,
     * closing the websocket, and waiting for the close event.
     *
     * @returns Resolves when websocket shutdown is complete.
     */
    return async () => {
        for (const pending of pendingCommands.values()) {
            pending.reject(new Error("Network response listener is shutting down."));
        }
        pendingCommands.clear();

        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            socket.close();
        }

        await new Promise<void>((resolve) => {
            if (socket.readyState === WebSocket.CLOSED) {
                resolve();
                return;
            }

            socket.once("close", () => {
                resolve();
            });
        });
    };
}
