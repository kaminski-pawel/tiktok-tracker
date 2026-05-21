import { randomUUID } from "node:crypto";
import { access, constants, mkdir, readFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

import type { RuntimeConfig, RuntimeMode } from "../config";

export interface ChromeSession {
    mode: RuntimeMode;
    devToolsBaseUrl: string;
    webSocketDebuggerUrl: string;
    close: () => Promise<void>;
}

interface DevToolsVersionResponse {
    webSocketDebuggerUrl: string;
}

const POLL_INTERVAL_MS = 250;

function isWslEnvironment(env: NodeJS.ProcessEnv): boolean {
    return typeof env["WSL_INTEROP"] === "string" && env["WSL_INTEROP"].trim() !== "";
}

function isWindowsExecutable(filePath: string): boolean {
    return filePath.toLowerCase().endsWith(".exe");
}

function toWindowsPath(filePath: string): string {
    const wslPathMatch = /^\/mnt\/([a-z])\/(.*)$/.exec(filePath);
    if (wslPathMatch === null) {
        return filePath;
    }

    const driveLetter = wslPathMatch[1];
    const rest = wslPathMatch[2];
    if (driveLetter === undefined || rest === undefined) {
        return filePath;
    }

    return `${driveLetter.toUpperCase()}:\\${rest.replaceAll("/", "\\")}`;
}

function getDefaultManagedUserDataDir(config: RuntimeConfig): string {
    if (isWslEnvironment(process.env) && config.chromePath !== undefined && isWindowsExecutable(config.chromePath)) {
        return `/mnt/c/Users/Public/tiktok-tracker/${randomUUID()}`;
    }

    return `/tmp/tiktok-tracker-${randomUUID()}`;
}

async function resolveUserDataDir(
    config: RuntimeConfig,
    chromePath: string
): Promise<{ localPath: string; launchArgumentPath: string }> {
    const localPath = config.chromeUserDataDir ?? getDefaultManagedUserDataDir(config);
    await mkdir(localPath, { recursive: true });

    if (isWslEnvironment(process.env) && isWindowsExecutable(chromePath)) {
        return {
            localPath,
            launchArgumentPath: toWindowsPath(localPath)
        };
    }

    return {
        localPath,
        launchArgumentPath: localPath
    };
}

function getDevToolsBaseUrl(config: RuntimeConfig): string {
    return `http://${config.debugHost}:${config.debugPort}`;
}

async function readDevToolsVersion(baseUrl: string): Promise<DevToolsVersionResponse> {
    const response = await fetch(`${baseUrl}/json/version`);
    if (!response.ok) {
        throw new Error(`DevTools endpoint returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as Partial<DevToolsVersionResponse>;
    if (typeof payload.webSocketDebuggerUrl !== "string") {
        throw new Error("DevTools endpoint does not expose webSocketDebuggerUrl");
    }

    return { webSocketDebuggerUrl: payload.webSocketDebuggerUrl };
}

async function waitForDevTools(baseUrl: string, timeoutMs: number): Promise<DevToolsVersionResponse> {
    const startedAt = Date.now();
    let lastError: unknown;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            return await readDevToolsVersion(baseUrl);
        } catch (error: unknown) {
            lastError = error;
        }

        await new Promise((resolve) => {
            setTimeout(resolve, POLL_INTERVAL_MS);
        });
    }

    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Timed out waiting for Chrome DevTools endpoint: ${reason}`);
}

async function waitForDevToolsActivePort(
    userDataDir: string,
    timeoutMs: number,
    host: string
): Promise<{ baseUrl: string; port: number; webSocketPath: string }> {
    const startedAt = Date.now();
    const activePortFilePath = join(userDataDir, "DevToolsActivePort");
    let lastError: unknown;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const contents = await readFile(activePortFilePath, "utf8");
            const [portLine, webSocketPathLine] = contents.split(/\r?\n/);
            const port = Number.parseInt(portLine ?? "", 10);

            if (!Number.isFinite(port) || port <= 0) {
                throw new Error(`Invalid DevTools port in ${activePortFilePath}`);
            }

            const webSocketPath = webSocketPathLine?.trim();
            if (webSocketPath === undefined || webSocketPath === "") {
                throw new Error(`Missing DevTools websocket path in ${activePortFilePath}`);
            }

            const baseUrl = `http://${host}:${port}`;

            return {
                baseUrl,
                port,
                webSocketPath
            };
        } catch (error: unknown) {
            lastError = error;
        }

        await new Promise((resolve) => {
            setTimeout(resolve, POLL_INTERVAL_MS);
        });
    }

    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Timed out waiting for DevToolsActivePort: ${reason}`);
}

function buildWebSocketDebuggerUrl(host: string, port: number, webSocketPath: string): string {
    if (webSocketPath.startsWith("ws://") || webSocketPath.startsWith("wss://")) {
        try {
            const parsedUrl = new URL(webSocketPath);
            parsedUrl.hostname = host;
            parsedUrl.port = String(port);
            return parsedUrl.toString();
        } catch {
            return webSocketPath;
        }
    }

    return `ws://${host}:${port}${webSocketPath.startsWith("/") ? webSocketPath : `/${webSocketPath}`}`;
}

async function resolveReachableManagedDevToolsEndpoint(
    preferredHost: string,
    port: number,
    webSocketPath: string,
    launchTimeoutMs: number
): Promise<{ baseUrl: string; webSocketDebuggerUrl: string }> {
    const hostCandidates = [preferredHost, "127.0.0.1", "localhost"].filter(
        (value, index, arr) => arr.indexOf(value) === index
    );

    let lastError: unknown;
    for (const host of hostCandidates) {
        const baseUrl = `http://${host}:${port}`;
        try {
            const version = await waitForDevTools(baseUrl, Math.min(launchTimeoutMs, 2_000));
            return {
                baseUrl,
                webSocketDebuggerUrl: version.webSocketDebuggerUrl
            };
        } catch (error: unknown) {
            lastError = error;

            // If /json/version is unreachable for a host candidate, still keep a fallback URL for later websocket use.
            if (host === preferredHost) {
                continue;
            }
        }
    }

    if (lastError !== undefined) {
        const reason = lastError instanceof Error ? lastError.message : String(lastError);
        process.stderr.write(`Falling back to inferred DevTools host after probe failure: ${reason}\n`);
    }

    return {
        baseUrl: `http://${preferredHost}:${port}`,
        webSocketDebuggerUrl: buildWebSocketDebuggerUrl(preferredHost, port, webSocketPath)
    };
}

async function resolveManagedLaunchHost(chromePath: string): Promise<string> {
    if (!(isWslEnvironment(process.env) && isWindowsExecutable(chromePath))) {
        return "127.0.0.1";
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
        // Fall through to loopback fallback.
    }

    return "127.0.0.1";
}

async function firstExistingPath(paths: string[]): Promise<string | undefined> {
    for (const path of paths) {
        try {
            await access(path);
            return path;
        } catch {
            // Continue until a valid executable path is found.
        }
    }

    return undefined;
}

async function resolveChromePath(explicitPath: string | undefined): Promise<string> {
    if (explicitPath !== undefined) {
        try {
            await access(explicitPath, constants.X_OK);
        } catch {
            throw new Error(
                `Configured Chrome executable is not accessible: ${explicitPath}. ` +
                "Set TRACKER_CHROME_PATH to a valid Chrome/Chromium executable or unset it to use auto-detection."
            );
        }

        return explicitPath;
    }

    const executable = await firstExistingPath([
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium"
    ]);

    if (executable === undefined) {
        throw new Error(
            "Unable to find Chrome/Chromium executable. Set TRACKER_CHROME_PATH explicitly."
        );
    }

    return executable;
}

function wireChromeProcessLogs(chromeProcess: ChildProcess): void {
    chromeProcess.stderr?.on("data", (chunk: Buffer) => {
        const message = chunk.toString().trim();
        if (message.length > 0) {
            process.stderr.write(`[chrome] ${message}\n`);
        }
    });
}

async function launchManagedChrome(config: RuntimeConfig): Promise<ChromeSession> {
    const chromePath = await resolveChromePath(config.chromePath);
    const userDataDir = await resolveUserDataDir(config, chromePath);
    const devToolsHost = await resolveManagedLaunchHost(chromePath);
    const args = [
        "--remote-debugging-port=0",
        `--remote-debugging-address=${devToolsHost === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0"}`,
        `--user-data-dir=${userDataDir.launchArgumentPath}`,
        "--no-first-run",
        "--no-default-browser-check",
        config.launchUrl
    ];

    const chromeProcess = spawn(chromePath, args, {
        stdio: ["ignore", "ignore", "pipe"]
    });

    wireChromeProcessLogs(chromeProcess);

    const spawnError = await new Promise<Error | undefined>((resolve) => {
        chromeProcess.once("spawn", () => {
            resolve(undefined);
        });
        chromeProcess.once("error", (error: Error) => {
            resolve(error);
        });
    });

    if (spawnError !== undefined) {
        throw new Error(`Failed to start Chrome process: ${spawnError.message}`);
    }

    if (chromeProcess.pid === undefined) {
        throw new Error("Chrome process started without a pid.");
    }

    const activePort = await Promise.race([
        waitForDevToolsActivePort(userDataDir.localPath, config.launchTimeoutMs, devToolsHost),
        new Promise<never>((_, reject) => {
            chromeProcess.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
                reject(
                    new Error(
                        `Chrome exited before DevTools became available (code=${code ?? "null"}, signal=${signal ?? "null"}).`
                    )
                );
            });
        })
    ]);

    const version = await resolveReachableManagedDevToolsEndpoint(
        devToolsHost,
        activePort.port,
        activePort.webSocketPath,
        config.launchTimeoutMs
    );

    return {
        mode: "managed-launch",
        devToolsBaseUrl: version.baseUrl,
        webSocketDebuggerUrl: version.webSocketDebuggerUrl,
        close: async () => {
            chromeProcess.kill("SIGTERM");
        }
    };
}

async function attachToExistingChrome(config: RuntimeConfig): Promise<ChromeSession> {
    const devToolsBaseUrl = getDevToolsBaseUrl(config);
    const version = await waitForDevTools(devToolsBaseUrl, config.launchTimeoutMs);

    return {
        mode: "attach-to-existing",
        devToolsBaseUrl,
        webSocketDebuggerUrl: version.webSocketDebuggerUrl,
        close: async () => Promise.resolve()
    };
}

export async function connectToChrome(config: RuntimeConfig): Promise<ChromeSession> {
    if (config.mode === "attach-to-existing") {
        return attachToExistingChrome(config);
    }

    return launchManagedChrome(config);
}