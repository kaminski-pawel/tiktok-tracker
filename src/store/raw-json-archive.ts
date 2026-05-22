import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CapturedResponse } from "../chrome/network-listener";

export interface RawJsonArchiveWriter {
    persistMatchedResponse(capturedResponse: CapturedResponse): Promise<string>;
}

/**
 * Formats a UTC date value using YYYY-MM-DD for date folder rotation.
 *
 * @param value Date to format.
 * @returns UTC date string.
 */
function formatUtcDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}

/**
 * Formats a UTC timestamp with millisecond precision for file names.
 *
 * @param value Date to format.
 * @returns Compact timestamp string safe for file names.
 */
function formatUtcTimestampForFile(value: Date): string {
    return value.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

/**
 * Sanitizes endpoint paths for use as nested folder names.
 *
 * @param endpointPath Captured endpoint path.
 * @returns Endpoint path without leading slash.
 */
function endpointPathToDirectory(endpointPath: string): string {
    return endpointPath.replace(/^\/+/, "");
}

/**
 * Sanitizes request ids for stable file names.
 *
 * @param requestId CDP request id.
 * @returns Request id containing only safe file name characters.
 */
function sanitizeRequestId(requestId: string): string {
    return requestId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Creates a writer that stores each matched payload as a standalone JSON file.
 *
 * Output structure:
 * - <archiveRootDir>/<YYYY-MM-DD>/<endpoint path>/<timestamp>_<requestId>.json
 *
 * @param archiveRootDir Root directory for archived response payloads.
 * @returns Archive writer.
 */
export function createRawJsonArchiveWriter(archiveRootDir: string): RawJsonArchiveWriter {
    return {
        async persistMatchedResponse(capturedResponse: CapturedResponse): Promise<string> {
            const now = new Date();
            const dayFolder = formatUtcDate(now);
            const endpointFolder = endpointPathToDirectory(capturedResponse.endpointPath);
            const fileName = `${formatUtcTimestampForFile(now)}_${sanitizeRequestId(capturedResponse.requestId)}.json`;
            const outputDirectory = join(archiveRootDir, dayFolder, endpointFolder);
            const outputPath = join(outputDirectory, fileName);

            await mkdir(outputDirectory, { recursive: true });
            await writeFile(outputPath, capturedResponse.body, "utf8");

            return outputPath;
        }
    };
}
