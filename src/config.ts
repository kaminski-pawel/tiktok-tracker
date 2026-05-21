export type RuntimeMode = "managed-launch" | "attach-to-existing";

export interface RuntimeConfig {
    mode: RuntimeMode;
    debugHost: string;
    debugPort: number;
    launchUrl: string;
    launchTimeoutMs: number;
    chromePath?: string;
    chromeUserDataDir?: string;
}

const DEFAULT_DEBUG_HOST = "127.0.0.1";
const DEFAULT_DEBUG_PORT = 9222;
const DEFAULT_LAUNCH_URL = "https://www.tiktok.com/";
const DEFAULT_LAUNCH_TIMEOUT_MS = 15_000;
const DEFAULT_WINDOWS_CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEFAULT_WSL_CHROME_PATH = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
const DEFAULT_MACOS_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function parsePositiveInteger(value: string | undefined, fallback: number): number {
    if (value === undefined || value.trim() === "") {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Expected a positive integer but got: ${value}`);
    }

    return parsed;
}

function parseRuntimeMode(value: string | undefined): RuntimeMode {
    if (value === undefined || value.trim() === "") {
        return "managed-launch";
    }

    if (value === "managed-launch" || value === "attach-to-existing") {
        return value;
    }

    throw new Error(
        `Invalid TRACKER_RUNTIME_MODE: ${value}. Use managed-launch or attach-to-existing.`
    );
}

function nonEmptyString(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}

function isWslEnvironment(env: NodeJS.ProcessEnv): boolean {
    return nonEmptyString(env["WSL_INTEROP"]) !== undefined;
}

function normalizeWindowsPathForWsl(filePath: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
    if (filePath === undefined) {
        return undefined;
    }

    if (!isWslEnvironment(env)) {
        return filePath;
    }

    const windowsPathMatch = /^[A-Za-z]:\\/.exec(filePath);
    if (windowsPathMatch === null) {
        return filePath;
    }

    const driveLetter = filePath[0]?.toLowerCase();
    if (driveLetter === undefined) {
        return filePath;
    }

    const pathWithoutDrive = filePath.slice(2).replaceAll("\\", "/");
    return `/mnt/${driveLetter}${pathWithoutDrive}`;
}

function getDefaultChromePath(env: NodeJS.ProcessEnv): string | undefined {
    if (process.platform === "win32") {
        return DEFAULT_WINDOWS_CHROME_PATH;
    }

    if (process.platform === "darwin") {
        return DEFAULT_MACOS_CHROME_PATH;
    }

    if (isWslEnvironment(env)) {
        return DEFAULT_WSL_CHROME_PATH;
    }

    return undefined;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
    const mode = parseRuntimeMode(env["TRACKER_RUNTIME_MODE"]);
    const debugHost = nonEmptyString(env["TRACKER_DEBUG_HOST"]) ?? DEFAULT_DEBUG_HOST;
    const debugPort = parsePositiveInteger(env["TRACKER_DEBUG_PORT"], DEFAULT_DEBUG_PORT);
    const launchUrl = nonEmptyString(env["TRACKER_LAUNCH_URL"]) ?? DEFAULT_LAUNCH_URL;
    const launchTimeoutMs = parsePositiveInteger(
        env["TRACKER_LAUNCH_TIMEOUT_MS"],
        DEFAULT_LAUNCH_TIMEOUT_MS
    );
    const chromePath =
        normalizeWindowsPathForWsl(nonEmptyString(env["TRACKER_CHROME_PATH"]), env) ??
        getDefaultChromePath(env);
    const chromeUserDataDir = normalizeWindowsPathForWsl(
        nonEmptyString(env["TRACKER_CHROME_USER_DATA_DIR"]),
        env
    );

    const config: RuntimeConfig = {
        mode,
        debugHost,
        debugPort,
        launchUrl,
        launchTimeoutMs
    };

    if (chromePath !== undefined) {
        config.chromePath = chromePath;
    }

    if (chromeUserDataDir !== undefined) {
        config.chromeUserDataDir = chromeUserDataDir;
    }

    return config;
}