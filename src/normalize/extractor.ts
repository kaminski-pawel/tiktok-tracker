import type { CapturedResponse } from "../chrome/network-listener";
import type { EndpointPath } from "../config";

export interface ItemListRowCandidate {
    itemIndex: number;
    sourceEndpoint: EndpointPath;
    requestId: string;
    requestUrl: string;
    status: number;
    videoId?: string;
    desc?: string;
    isAd?: boolean;
    authorNickname?: string;
    authorPrivateAccount?: boolean;
    authorUniqueId?: string;
    authorStatsDiggCount?: number;
    authorStatsFollowerCount?: number;
    authorStatsFollowingCount?: number;
    authorStatsFriendCount?: number;
    authorStatsHeart?: number;
    authorStatsHeartCount?: number;
    authorStatsVideoCount?: number;
    contentsDesc: string[];
    musicAuthorName?: string;
    statsCollectCount?: number;
    statsCommentCount?: number;
    statsDiggCount?: number;
    statsPlayCount?: number;
    statsShareCount?: number;
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
 * Reads a value from a record using the first matching key variant.
 *
 * @param value Source record.
 * @param keys Candidate key names.
 * @returns First present value.
 */
function readVariant(value: UnknownRecord | undefined, keys: string[]): unknown {
    if (value === undefined) {
        return undefined;
    }

    for (const key of keys) {
        const current = value[key];
        if (current !== undefined) {
            return current;
        }
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
 * Extracts every supported row candidate field from one item payload.
 *
 * @param itemItem item payload object.
 * @param capturedResponse Source response metadata.
 * @param itemIndex Item position in the item list.
 * @returns Flattened row candidate.
 */
function toRowCandidate(
    item: UnknownRecord,
    capturedResponse: CapturedResponse,
    itemIndex: number
): ItemListRowCandidate {
    const author = asRecord(readVariant(item, ["author"]));
    const authorStats =
        asRecord(readVariant(item, ["authorStats", "author_stats"])) ??
        asRecord(readVariant(author, ["stats", "authorStats", "author_stats"]));
    const music = asRecord(readVariant(item, ["music"]));
    const stats = asRecord(readVariant(item, ["stats", "statistics"]));

    const rawContents = readVariant(item, ["contents", "content_list"]);
    const contentsDesc: string[] = [];
    if (Array.isArray(rawContents)) {
        for (const contentItem of rawContents) {
            const contentRecord = asRecord(contentItem);
            const desc = toStringValue(readVariant(contentRecord, ["desc", "description", "text"]));
            if (desc !== undefined) {
                contentsDesc.push(desc);
            }
        }
    }

    const rowCandidate: ItemListRowCandidate = {
        itemIndex,
        sourceEndpoint: capturedResponse.endpointPath,
        requestId: capturedResponse.requestId,
        requestUrl: capturedResponse.requestUrl,
        status: capturedResponse.status,
        contentsDesc,
    };

    const videoId = toStringValue(readVariant(item, ["id", "awemeId", "aweme_id", "itemId", "item_id"]));
    if (videoId !== undefined) {
        rowCandidate.videoId = videoId;
    }

    const desc = toStringValue(readVariant(item, ["desc", "description"]));
    if (desc !== undefined) {
        rowCandidate.desc = desc;
    }

    const isAd = toBooleanValue(readVariant(item, ["isAd", "is_ad", "ad"]));
    if (isAd !== undefined) {
        rowCandidate.isAd = isAd;
    }

    const authorNickname = toStringValue(readVariant(author, ["nickname", "nick_name"]));
    if (authorNickname !== undefined) {
        rowCandidate.authorNickname = authorNickname;
    }

    const authorPrivateAccount = toBooleanValue(readVariant(author, ["privateAccount", "private_account"]));
    if (authorPrivateAccount !== undefined) {
        rowCandidate.authorPrivateAccount = authorPrivateAccount;
    }

    const authorUniqueId = toStringValue(readVariant(author, ["uniqueId", "unique_id"]));
    if (authorUniqueId !== undefined) {
        rowCandidate.authorUniqueId = authorUniqueId;
    }

    const authorStatsDiggCount = toNumberValue(readVariant(authorStats, ["diggCount", "digg_count"]));
    if (authorStatsDiggCount !== undefined) {
        rowCandidate.authorStatsDiggCount = authorStatsDiggCount;
    }

    const authorStatsFollowerCount = toNumberValue(readVariant(authorStats, ["followerCount", "follower_count"]));
    if (authorStatsFollowerCount !== undefined) {
        rowCandidate.authorStatsFollowerCount = authorStatsFollowerCount;
    }

    const authorStatsFollowingCount = toNumberValue(readVariant(authorStats, ["followingCount", "following_count"]));
    if (authorStatsFollowingCount !== undefined) {
        rowCandidate.authorStatsFollowingCount = authorStatsFollowingCount;
    }

    const authorStatsFriendCount = toNumberValue(readVariant(authorStats, ["friendCount", "friend_count"]));
    if (authorStatsFriendCount !== undefined) {
        rowCandidate.authorStatsFriendCount = authorStatsFriendCount;
    }

    const authorStatsHeart = toNumberValue(readVariant(authorStats, ["heart"]));
    if (authorStatsHeart !== undefined) {
        rowCandidate.authorStatsHeart = authorStatsHeart;
    }

    const authorStatsHeartCount = toNumberValue(readVariant(authorStats, ["heartCount", "heart_count"]));
    if (authorStatsHeartCount !== undefined) {
        rowCandidate.authorStatsHeartCount = authorStatsHeartCount;
    }

    const authorStatsVideoCount = toNumberValue(readVariant(authorStats, ["videoCount", "video_count"]));
    if (authorStatsVideoCount !== undefined) {
        rowCandidate.authorStatsVideoCount = authorStatsVideoCount;
    }

    const musicAuthorName = toStringValue(readVariant(music, ["authorName", "author_name"]));
    if (musicAuthorName !== undefined) {
        rowCandidate.musicAuthorName = musicAuthorName;
    }

    const statsCollectCount = toNumberValue(readVariant(stats, ["collectCount", "collect_count"]));
    if (statsCollectCount !== undefined) {
        rowCandidate.statsCollectCount = statsCollectCount;
    }

    const statsCommentCount = toNumberValue(readVariant(stats, ["commentCount", "comment_count"]));
    if (statsCommentCount !== undefined) {
        rowCandidate.statsCommentCount = statsCommentCount;
    }

    const statsDiggCount = toNumberValue(readVariant(stats, ["diggCount", "digg_count"]));
    if (statsDiggCount !== undefined) {
        rowCandidate.statsDiggCount = statsDiggCount;
    }

    const statsPlayCount = toNumberValue(readVariant(stats, ["playCount", "play_count"]));
    if (statsPlayCount !== undefined) {
        rowCandidate.statsPlayCount = statsPlayCount;
    }

    const statsShareCount = toNumberValue(readVariant(stats, ["shareCount", "share_count"]));
    if (statsShareCount !== undefined) {
        rowCandidate.statsShareCount = statsShareCount;
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
 * @returns Flattened row candidates.
 */
export function extractItemListRowCandidates(capturedResponse: CapturedResponse): ItemListRowCandidate[] {
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

        rowCandidates.push(toRowCandidate(item, capturedResponse, itemIndex));
    }

    return rowCandidates;
}