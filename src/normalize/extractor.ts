import type { CapturedResponse } from "../chrome/network-listener";
import type { EndpointPath } from "../config";
import type { CsvColumnMapping } from "../schema/csv-schema";
import { DEFAULT_CSV_COLUMN_SCHEMA_CONFIG } from "../schema/csv-schema";

export interface ItemListRowCandidate {
    itemIndex: number;
    sourceEndpoint: EndpointPath;
    requestId: string;
    requestUrl: string;
    status: number;
    columns: Record<string, string | number | boolean | string[]>;
    [columnName: string]: unknown;
}

type UnknownRecord = Record<string, unknown>;

/**
 * Converts an unknown value into a plain object record.
 *
 * @param value Raw unknown value.
 * @returns Object record when valid, otherwise undefined.
 */
function asRecord(value: unknown): UnknownRecord | undefined {
    if (typeof value === "object" && value !== null) {
        return value as UnknownRecord;
    }

    return undefined;
}

/**
 * Resolves nested data by trying known path variants in order.
 *
 * @param value Root record.
 * @param candidatePaths Path variants to test.
 * @returns First resolved value.
 */
function readPathVariant(value: UnknownRecord, candidatePaths: string[][]): unknown {
    for (const path of candidatePaths) {
        let current: unknown = value;
        let valid = true;

        for (const key of path) {
            const currentRecord = asRecord(current);
            if (currentRecord === undefined) {
                valid = false;
                break;
            }

            current = currentRecord[key];
        }

        if (valid && current !== undefined) {
            return current;
        }
    }

    return undefined;
}

/**
 * Splits a dot notation path (with optional [] array token) into segments.
 *
 * @param path Schema path expression.
 * @returns Segments for path traversal.
 */
function toPathSegments(path: string): string[] {
    return path
        .split(".")
        .map((segment) => segment.trim())
        .filter((segment) => segment !== "");
}

/**
 * Reads all values that match a path expression from an object.
 *
 * The `[]` token at the end of a path segment expands array elements.
 * Example: `contents[].desc` reads `desc` from every object in `contents`.
 *
 * @param current Current traversal value.
 * @param segments Path segments.
 * @param index Current segment index.
 * @returns All values matched by the path.
 */
function readPathValues(current: unknown, segments: string[], index: number): unknown[] {
    if (index >= segments.length) {
        return [current];
    }

    const segment = segments[index];
    if (segment === undefined) {
        return [];
    }

    if (segment.endsWith("[]")) {
        const arrayKey = segment.slice(0, -2);
        const currentRecord = asRecord(current);
        if (currentRecord === undefined) {
            return [];
        }

        const arrayValue = currentRecord[arrayKey];
        if (!Array.isArray(arrayValue)) {
            return [];
        }

        const values: unknown[] = [];
        for (const entry of arrayValue) {
            values.push(...readPathValues(entry, segments, index + 1));
        }

        return values;
    }

    const currentRecord = asRecord(current);
    if (currentRecord === undefined) {
        return [];
    }

    const nextValue = currentRecord[segment];
    if (nextValue === undefined) {
        return [];
    }

    return readPathValues(nextValue, segments, index + 1);
}

/**
 * Normalizes mixed primitive values into strings.
 *
 * @param value Raw value.
 * @returns String form when conversion is safe.
 */
function toStringValue(value: unknown): string | undefined {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }

    if (typeof value === "number" || typeof value === "bigint") {
        return String(value);
    }

    return undefined;
}

/**
 * Normalizes mixed primitive values into booleans.
 *
 * @param value Raw value.
 * @returns Boolean form when conversion is safe.
 */
function toBooleanValue(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (value === 1) {
            return true;
        }

        if (value === 0) {
            return false;
        }
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
            return true;
        }

        if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
            return false;
        }
    }

    return undefined;
}

/**
 * Normalizes mixed primitive values into finite numbers.
 *
 * @param value Raw value.
 * @returns Number form when conversion is safe.
 */
function toNumberValue(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
            return undefined;
        }

        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return undefined;
}

/**
 * Converts all matching path values into one configured column value.
 *
 * @param item Source item payload.
 * @param mapping Column mapping definition.
 * @returns Typed column value when available.
 */
function resolveMappedColumnValue(
    item: UnknownRecord,
    mapping: CsvColumnMapping
): string | number | boolean | string[] | undefined {
    const rawValues: unknown[] = [];
    for (const path of mapping.paths) {
        rawValues.push(...readPathValues(item, toPathSegments(path), 0));
    }

    if (mapping.type === "string[]") {
        const values: string[] = [];
        for (const rawValue of rawValues) {
            const normalized = toStringValue(rawValue);
            if (normalized !== undefined) {
                values.push(normalized);
            }
        }

        return values.length > 0 ? values : undefined;
    }

    for (const rawValue of rawValues) {
        if (mapping.type === "string") {
            const normalized = toStringValue(rawValue);
            if (normalized !== undefined) {
                return normalized;
            }

            continue;
        }

        if (mapping.type === "boolean") {
            const normalized = toBooleanValue(rawValue);
            if (normalized !== undefined) {
                return normalized;
            }

            continue;
        }

        const normalized = toNumberValue(rawValue);
        if (normalized !== undefined) {
            return normalized;
        }
    }

    return undefined;
}

/**
 * Parses the captured response body into a JSON object.
 *
 * @param body Raw response body.
 * @returns Parsed JSON object, or undefined when parsing fails.
 */
function parseJsonObject(body: string): UnknownRecord | undefined {
    try {
        return asRecord(JSON.parse(body));
    } catch {
        return undefined;
    }
}

/**
 * Finds the response item array across known TikTok payload variants.
 *
 * @param payload Parsed response payload.
 * @returns Item array, or an empty array when not available.
 */
function resolveItemList(payload: UnknownRecord): unknown[] {
    const rawItemList = readPathVariant(payload, [
        ["itemList"],
        ["item_list"],
        ["items"],
        ["aweme_list"],
        ["data", "itemList"],
        ["data", "item_list"],
        ["data", "items"],
        ["data", "aweme_list"]
    ]);

    return Array.isArray(rawItemList) ? rawItemList : [];
}

/**
 * Extracts configured row candidate columns from one item payload.
 *
 * @param item Item payload object.
 * @param capturedResponse Source response metadata.
 * @param itemIndex Item position in the item list.
 * @param columnMappings Column mapping definitions.
 * @returns Flattened row candidate.
 */
function toRowCandidate(
    item: UnknownRecord,
    capturedResponse: CapturedResponse,
    itemIndex: number,
    columnMappings: CsvColumnMapping[]
): ItemListRowCandidate {
    const rowCandidate: ItemListRowCandidate = {
        itemIndex,
        sourceEndpoint: capturedResponse.endpointPath,
        requestId: capturedResponse.requestId,
        requestUrl: capturedResponse.requestUrl,
        status: capturedResponse.status,
        columns: {}
    };

    for (const columnMapping of columnMappings) {
        const value = resolveMappedColumnValue(item, columnMapping);
        if (value === undefined) {
            continue;
        }

        rowCandidate.columns[columnMapping.columnName] = value;
        rowCandidate[columnMapping.columnName] = value;
    }

    return rowCandidate;
}

/**
 * Flattens a captured endpoint response into row candidates from `itemList`.
 *
 * The extractor is resilient to missing data and known variant field names.
 * If parsing fails or no supported item list exists, it returns an empty array.
 *
 * @param capturedResponse Captured network response payload.
 * @param columnMappings Configurable mappings from item payload to column values.
 * @returns Flattened row candidates.
 */
export function extractItemListRowCandidates(
    capturedResponse: CapturedResponse,
    columnMappings: CsvColumnMapping[] = DEFAULT_CSV_COLUMN_SCHEMA_CONFIG.columns
): ItemListRowCandidate[] {
    const payload = parseJsonObject(capturedResponse.body);
    if (payload === undefined) {
        return [];
    }

    const itemList = resolveItemList(payload);
    if (itemList.length === 0) {
        return [];
    }

    const rowCandidates: ItemListRowCandidate[] = [];
    for (let itemIndex = 0; itemIndex < itemList.length; itemIndex += 1) {
        const item = asRecord(itemList[itemIndex]);
        if (item === undefined) {
            continue;
        }

        rowCandidates.push(toRowCandidate(item, capturedResponse, itemIndex, columnMappings));
    }

    return rowCandidates;
}
