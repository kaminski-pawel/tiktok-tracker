import { readFileSync } from "node:fs";

export type CsvColumnValueType = "string" | "number" | "boolean" | "string[]";

export interface CsvColumnMapping {
    columnName: string;
    type: CsvColumnValueType;
    paths: string[];
}

export interface CsvColumnSchemaConfig {
    columns: CsvColumnMapping[];
}

/**
 * Default schema used when no external mapping file is supplied.
 */
export const DEFAULT_CSV_COLUMN_SCHEMA_CONFIG: CsvColumnSchemaConfig = {
    columns: [
        {
            columnName: "id",
            type: "string",
            paths: ["id", "awemeId", "aweme_id", "itemId", "item_id"]
        },
        {
            columnName: "desc",
            type: "string",
            paths: ["desc", "description"]
        },
        {
            columnName: "isAd",
            type: "boolean",
            paths: ["isAd", "is_ad", "ad"]
        },
        {
            columnName: "author.nickname",
            type: "string",
            paths: ["author.nickname", "author.nick_name"]
        },
        {
            columnName: "author.uniqueId",
            type: "string",
            paths: ["author.uniqueId", "author.unique_id"]
        },
        {
            columnName: "authorStats.diggCount",
            type: "number",
            paths: [
                "authorStats.diggCount",
                "authorStats.digg_count",
                "author_stats.diggCount",
                "author_stats.digg_count",
                "author.stats.diggCount",
                "author.stats.digg_count"
            ]
        },
        {
            columnName: "authorStats.followerCount",
            type: "number",
            paths: [
                "authorStats.followerCount",
                "authorStats.follower_count",
                "author_stats.followerCount",
                "author_stats.follower_count",
                "author.stats.followerCount",
                "author.stats.follower_count"
            ]
        },
        {
            columnName: "authorStats.followingCount",
            type: "number",
            paths: [
                "authorStats.followingCount",
                "authorStats.following_count",
                "author_stats.followingCount",
                "author_stats.following_count",
                "author.stats.followingCount",
                "author.stats.following_count"
            ]
        },
        {
            columnName: "authorStats.heartCount",
            type: "number",
            paths: [
                "authorStats.heartCount",
                "authorStats.heart_count",
                "author_stats.heartCount",
                "author_stats.heart_count",
                "author.stats.heartCount",
                "author.stats.heart_count"
            ]
        },
        {
            columnName: "authorStats.videoCount",
            type: "number",
            paths: [
                "authorStats.videoCount",
                "authorStats.video_count",
                "author_stats.videoCount",
                "author_stats.video_count",
                "author.stats.videoCount",
                "author.stats.video_count"
            ]
        },
        {
            columnName: "contents[].desc",
            type: "string[]",
            paths: [
                "contents[].desc",
                "contents[].description",
                "contents[].text",
                "content_list[].desc",
                "content_list[].description",
                "content_list[].text"
            ]
        },
        {
            columnName: "music.authorName",
            type: "string",
            paths: ["music.authorName", "music.author_name"]
        },
        {
            columnName: "stats.collectCount",
            type: "number",
            paths: ["stats.collectCount", "stats.collect_count", "statistics.collectCount", "statistics.collect_count"]
        },
        {
            columnName: "stats.commentCount",
            type: "number",
            paths: ["stats.commentCount", "stats.comment_count", "statistics.commentCount", "statistics.comment_count"]
        },
        {
            columnName: "stats.diggCount",
            type: "number",
            paths: ["stats.diggCount", "stats.digg_count", "statistics.diggCount", "statistics.digg_count"]
        },
        {
            columnName: "stats.playCount",
            type: "number",
            paths: ["stats.playCount", "stats.play_count", "statistics.playCount", "statistics.play_count"]
        },
        {
            columnName: "stats.shareCount",
            type: "number",
            paths: ["stats.shareCount", "stats.share_count", "statistics.shareCount", "statistics.share_count"]
        }
    ]
};

/**
 * Validates and normalizes a raw schema object loaded from JSON.
 *
 * @param rawSchema Raw parsed JSON value.
 * @param sourceLabel Source description used for error context.
 * @returns Validated schema config.
 */
function validateCsvColumnSchemaConfig(rawSchema: unknown, sourceLabel: string): CsvColumnSchemaConfig {
    if (typeof rawSchema !== "object" || rawSchema === null) {
        throw new Error(`CSV schema config at ${sourceLabel} must be an object.`);
    }

    const record = rawSchema as Record<string, unknown>;
    if (!Array.isArray(record["columns"])) {
        throw new Error(`CSV schema config at ${sourceLabel} must include a columns array.`);
    }

    const seenColumnNames = new Set<string>();
    const columns: CsvColumnMapping[] = [];

    for (const columnEntry of record["columns"]) {
        if (typeof columnEntry !== "object" || columnEntry === null) {
            throw new Error(`CSV schema config at ${sourceLabel} contains an invalid column entry.`);
        }

        const columnRecord = columnEntry as Record<string, unknown>;
        const columnName = typeof columnRecord["columnName"] === "string" ? columnRecord["columnName"].trim() : "";
        if (columnName === "") {
            throw new Error(`CSV schema config at ${sourceLabel} has a column with an empty columnName.`);
        }

        if (seenColumnNames.has(columnName)) {
            throw new Error(`CSV schema config at ${sourceLabel} has duplicate columnName: ${columnName}.`);
        }

        const type = columnRecord["type"];
        if (type !== "string" && type !== "number" && type !== "boolean" && type !== "string[]") {
            throw new Error(
                `CSV schema config at ${sourceLabel} has unsupported type for column ${columnName}. ` +
                    "Supported values: string, number, boolean, string[]."
            );
        }

        const pathsValue = columnRecord["paths"];
        if (!Array.isArray(pathsValue) || pathsValue.length === 0) {
            throw new Error(`CSV schema config at ${sourceLabel} column ${columnName} must include at least one path.`);
        }

        const paths: string[] = [];
        for (const pathValue of pathsValue) {
            if (typeof pathValue !== "string" || pathValue.trim() === "") {
                throw new Error(`CSV schema config at ${sourceLabel} column ${columnName} has an invalid path.`);
            }

            paths.push(pathValue.trim());
        }

        seenColumnNames.add(columnName);
        columns.push({
            columnName,
            type,
            paths
        });
    }

    return { columns };
}

/**
 * Loads CSV column mappings from a JSON configuration file.
 *
 * @param schemaConfigPath Absolute or relative path to schema JSON.
 * @returns Validated CSV schema config.
 */
export function loadCsvColumnSchemaConfig(schemaConfigPath: string): CsvColumnSchemaConfig {
    let fileContents: string;
    try {
        fileContents = readFileSync(schemaConfigPath, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read CSV schema config at ${schemaConfigPath}: ${message}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(fileContents);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse CSV schema config JSON at ${schemaConfigPath}: ${message}`);
    }

    return validateCsvColumnSchemaConfig(parsed, schemaConfigPath);
}
