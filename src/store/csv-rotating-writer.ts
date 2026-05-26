import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";

import type { ItemListRowCandidate } from "../normalize/extractor";
import type { CsvColumnMapping } from "../schema/csv-schema";

const CSV_METADATA_COLUMNS = [
    "capture_run_id",
    "source_endpoint",
    "request_url",
    "fetched_at_utc+1",
] as const;

export interface CsvRotatingWriter {
    appendRowCandidates(rowCandidates: ItemListRowCandidate[]): Promise<string[]>;
}

/**
 * Formats a UTC date value using YYYY-MM-DD for daily CSV rotation.
 *
 * @param value Date to format.
 * @returns UTC date string.
 */
function formatUtcDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}

/**
 * Converts an endpoint path into a file-name-safe token.
 *
 * @param endpointPath API endpoint path.
 * @returns Sanitized endpoint token.
 */
function sanitizeEndpointPath(endpointPath: string): string {
    const normalized = endpointPath.replaceAll("/", "_").replaceAll("-", "_");
    return normalized.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Formats a timestamp string with a fixed UTC+1 offset suffix.
 *
 * @param value Date to format.
 * @returns ISO-like timestamp with +01:00 suffix.
 */
function formatUtcPlusOneTimestamp(value: Date): string {
    const utcPlusOne = new Date(value.getTime() + 60 * 60 * 1000);
    return utcPlusOne.toISOString().replace("Z", "+01:00");
}

/**
 * Converts one CSV cell value into a file-safe CSV field.
 *
 * Arrays are flattened into a human-readable delimiter instead of embedding raw JSON.
 *
 * @param value Raw column value.
 * @returns Escaped CSV field text.
 */
function formatCsvField(value: string | number | boolean | string[] | undefined): string {
    if (value === undefined) {
        return "";
    }

    const rawValue = Array.isArray(value) ? value.join(" | ") : String(value);
    if (!/[",\n\r]/.test(rawValue)) {
        return rawValue;
    }

    return `"${rawValue.replaceAll('"', '""')}"`;
}

/**
 * Parses a single CSV line into field values.
 *
 * @param line CSV line without the trailing newline.
 * @returns Parsed field values.
 */

/**
 * Checks whether a file already exists.
 *
 * @param filePath File path to check.
 * @returns True when the file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Creates a rotating CSV writer that appends extracted rows using the configured schema order.
 *
 * Output structure:
 * - <csvRootDir>/tiktok_<YYYY-MM-DD>.csv
 *
 * @param csvRootDir Root directory for CSV output files.
 * @param columnMappings Ordered column mappings that define CSV headers.
 * @param nowProvider Optional date provider for testing.
 * @returns CSV writer.
 */
export function createCsvRotatingWriter(
    csvRootDir: string,
    columnMappings: CsvColumnMapping[],
    captureRunId: string,
    nowProvider: () => Date = () => new Date()
): CsvRotatingWriter {
    const headerColumns = [
        ...columnMappings.map((column) => column.columnName),
        ...CSV_METADATA_COLUMNS
    ];
    const headerLine = `${headerColumns.map((columnName) => formatCsvField(columnName)).join(",")}\n`;

    return {
        async appendRowCandidates(rowCandidates: ItemListRowCandidate[]): Promise<string[]> {
            if (rowCandidates.length === 0) {
                return [];
            }

            const outputDate = formatUtcDate(nowProvider());
            await mkdir(csvRootDir, { recursive: true });

            const now = nowProvider();
            const seenAtUtcPlusOne = formatUtcPlusOneTimestamp(now);
            const rowCandidatesByEndpoint = new Map<string, ItemListRowCandidate[]>();
            for (const rowCandidate of rowCandidates) {
                const endpointRows = rowCandidatesByEndpoint.get(rowCandidate.sourceEndpoint) ?? [];
                endpointRows.push(rowCandidate);
                rowCandidatesByEndpoint.set(rowCandidate.sourceEndpoint, endpointRows);
            }

            const outputPaths: string[] = [];
            for (const [sourceEndpoint, endpointRows] of rowCandidatesByEndpoint.entries()) {
                const outputPath = join(
                    csvRootDir,
                    `tiktok_${outputDate}_${sanitizeEndpointPath(sourceEndpoint)}_${captureRunId}.csv`
                );

                if (!(await fileExists(outputPath))) {
                    await writeFile(outputPath, headerLine, "utf8");
                }

                const lines = endpointRows
                    .map((rowCandidate) =>
                        `${[
                            ...columnMappings
                            .map((column) =>
                                formatCsvField(rowCandidate.columns[column.columnName] as string | number | boolean | string[] | undefined)
                            ),
                            formatCsvField(captureRunId),
                            formatCsvField(rowCandidate.sourceEndpoint),
                            formatCsvField(rowCandidate.requestUrl),
                            formatCsvField(seenAtUtcPlusOne)
                        ].join(",")}\n`
                    )
                    .join("");

                await appendFile(outputPath, lines, "utf8");
                outputPaths.push(outputPath);
            }

            return outputPaths;
        }
    };
}
