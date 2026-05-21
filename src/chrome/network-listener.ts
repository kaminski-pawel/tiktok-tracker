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

interface GetResponseBodyResult {
    body: string;
    base64Encoded?: boolean;
}

const CONNECT_RETRY_INTERVAL_MS = 250;
const CONNECT_TIMEOUT_MS = 15_000;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

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

function decodeResponseBody(result: GetResponseBodyResult): string {
    if (result.base64Encoded === true) {
        return Buffer.from(result.body, "base64").toString("utf8");
    }

    return result.body;
}

function resolveEndpointPath(requestUrl: string, enabledEndpointPaths: EndpointPath[]): EndpointPath | undefined {
    return enabledEndpointPaths.find((path) => requestUrl.includes(path));
}

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

function isSuccessResponse(value: unknown): value is JsonRpcSuccessResponse {
    return (
        isObject(value) &&
        typeof value["id"] === "number" &&
        isObject(value["result"])
    );
}

function isErrorResponse(value: unknown): value is JsonRpcErrorResponse {
    if (!isObject(value)) {
        return false;
    }

    const error = value["error"];
    return typeof value["id"] === "number" && isObject(error) && typeof error["message"] === "string";
}

function isRpcEvent(value: unknown): value is JsonRpcEvent {
    return isObject(value) && typeof value["method"] === "string";
}

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

    const closeWithError = (error: Error): void => {
        for (const pending of pendingCommands.values()) {
            pending.reject(error);
        }
        pendingCommands.clear();
    };

    const enableNetworkForSession = async (sessionId: string): Promise<void> => {
        if (pageSessionIds.has(sessionId)) {
            return;
        }

        pageSessionIds.add(sessionId);
        await sendCommand("Network.enable", {}, sessionId);
    };

    const handleNetworkResponseReceived = async (event: JsonRpcEvent): Promise<void> => {
        const parsedEvent = parseNetworkResponseReceivedEvent(event);
        if (parsedEvent === undefined) {
            return;
        }

        const endpointPath = resolveEndpointPath(parsedEvent.response.url, enabledEndpointPaths);
        if (endpointPath === undefined) {
            return;
        }

        const result = await sendCommand(
            "Network.getResponseBody",
            { requestId: parsedEvent.requestId },
            event.sessionId
        );

        const parsedBody = parseGetResponseBodyResult(result);
        if (parsedBody === undefined) {
            return;
        }

        await onCapturedResponse({
            endpointPath,
            requestId: parsedEvent.requestId,
            requestUrl: parsedEvent.response.url,
            status: parsedEvent.response.status,
            body: decodeResponseBody(parsedBody)
        });
    };

    socket.on("message", (message: RawData) => {
        void (async () => {
            const data = rawMessageToString(message);
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

            if (payload.method === "Network.responseReceived") {
                try {
                    await handleNetworkResponseReceived(payload);
                } catch (error: unknown) {
                    const messageText = error instanceof Error ? error.message : String(error);
                    process.stderr.write(`Failed to process network response event: ${messageText}\n`);
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
