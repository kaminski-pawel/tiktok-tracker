export type RuntimeMode = "managed-launch" | "attach-to-existing";

export const RECOMMEND_ITEM_LIST_ENDPOINT = "/api/recommend/item_list";
export const PREFETCH_EXPLORE_ITEM_LIST_ENDPOINT = "/api/prefetch/explore/item_list";
export const PRELOAD_ITEM_LIST_ENDPOINT = "/api/preload/item_list";

export type EndpointPath =
    | typeof RECOMMEND_ITEM_LIST_ENDPOINT
    | typeof PREFETCH_EXPLORE_ITEM_LIST_ENDPOINT
    | typeof PRELOAD_ITEM_LIST_ENDPOINT;

export interface RuntimeConfig {
    mode: RuntimeMode;
    debugHost: string;
    debugPort: number;
    launchUrl: string;
    launchTimeoutMs: number;
    enabledEndpointPaths: EndpointPath[];
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

/**
 * Parses environment-style boolean values used by endpoint toggle flags.
 *
 * Accepted truthy values: `1`, `true`, `yes`, `on`.
 * Accepted falsy values: `0`, `false`, `no`, `off`.
 *
 * @param value Raw environment value.
 * @param fallback Default value when input is missing or blank.
 * @returns Parsed boolean value.
 * @throws Error When the input is present but not a supported boolean token.
 */
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value.trim() === "") {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
        return true;
    }

    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
        return false;
    }

    throw new Error(
        `Expected a boolean value but got: ${value}. Use true/false, 1/0, yes/no, or on/off.`
    );
}

/**
 * Resolves the set of enabled API endpoint paths from environment toggles.
 *
 * `TRACKER_ENDPOINT_RECOMMEND_ITEM_LIST_ENABLED` defaults to enabled, while
 * optional endpoints are disabled by default. At least one endpoint must remain
 * enabled for capture to run.
 *
 * @param env Process environment variables.
 * @returns Enabled endpoint paths in configuration order.
 * @throws Error When all endpoint toggles are disabled.
 */
function resolveEnabledEndpointPaths(env: NodeJS.ProcessEnv): EndpointPath[] {
    const recommendEnabled = parseBoolean(env["TRACKER_ENDPOINT_RECOMMEND_ITEM_LIST_ENABLED"], true);
    const prefetchExploreEnabled = parseBoolean(
        env["TRACKER_ENDPOINT_PREFETCH_EXPLORE_ITEM_LIST_ENABLED"],
        false
    );
    const preloadEnabled = parseBoolean(env["TRACKER_ENDPOINT_PRELOAD_ITEM_LIST_ENABLED"], false);

    const enabledPaths: EndpointPath[] = [];
    if (recommendEnabled) {
        enabledPaths.push(RECOMMEND_ITEM_LIST_ENDPOINT);
    }

    if (prefetchExploreEnabled) {
        enabledPaths.push(PREFETCH_EXPLORE_ITEM_LIST_ENDPOINT);
    }

    if (preloadEnabled) {
        enabledPaths.push(PRELOAD_ITEM_LIST_ENDPOINT);
    }

    if (enabledPaths.length === 0) {
        throw new Error(
            "At least one capture endpoint must be enabled. " +
            "Set TRACKER_ENDPOINT_RECOMMEND_ITEM_LIST_ENABLED=true or enable another endpoint toggle."
        );
    }

    return enabledPaths;
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
    const enabledEndpointPaths = resolveEnabledEndpointPaths(env);
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
        enabledEndpointPaths,
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