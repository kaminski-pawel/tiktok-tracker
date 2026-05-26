const assert = require("node:assert/strict");
const test = require("node:test");

const {
    extractItemListRowCandidates
} = require("../dist/normalize/extractor.js");
const {
    loadCsvColumnSchemaConfig
} = require("../dist/schema/csv-schema.js");

test("extracts row candidates from standard and variant itemList payloads", () => {
    const capturedResponse = {
        endpointPath: "/api/recommend/item_list",
        requestId: "req-42",
        requestUrl: "https://www.tiktok.com/api/recommend/item_list?cursor=42",
        status: 200,
        body: JSON.stringify({
            data: {
                item_list: [
                    {
                        id: "video-1",
                        desc: "first desc",
                        isAd: false,
                        author: {
                            nickname: "author-one",
                            privateAccount: false,
                            uniqueId: "author_one"
                        },
                        authorStats: {
                            diggCount: 10,
                            followerCount: 20,
                            followingCount: 30,
                            friendCount: 40,
                            heart: 50,
                            heartCount: 60,
                            videoCount: 70
                        },
                        contents: [{ desc: "content-a" }, { desc: "content-b" }],
                        music: { authorName: "music-one" },
                        stats: {
                            collectCount: 1,
                            commentCount: 2,
                            diggCount: 3,
                            playCount: 4,
                            shareCount: 5
                        }
                    },
                    {
                        aweme_id: 987654,
                        description: "second desc",
                        is_ad: "1",
                        author: {
                            nick_name: "author-two",
                            private_account: "true",
                            unique_id: "author_two",
                            stats: {
                                digg_count: "100",
                                follower_count: "200",
                                following_count: "300",
                                friend_count: "400",
                                heart: "500",
                                heart_count: "600",
                                video_count: "700"
                            }
                        },
                        content_list: [{ text: "fallback-content" }, "invalid-item"],
                        music: { author_name: "music-two" },
                        statistics: {
                            collect_count: "11",
                            comment_count: "22",
                            digg_count: "33",
                            play_count: "44",
                            share_count: "55"
                        }
                    }
                ]
            }
        })
    };

    const rowCandidates = extractItemListRowCandidates(capturedResponse);

    assert.equal(rowCandidates.length, 2);

    assert.equal(rowCandidates[0].id, "video-1");
    assert.equal(rowCandidates[0].desc, "first desc");
    assert.equal(rowCandidates[0]["author.nickname"], "author-one");
    assert.deepEqual(rowCandidates[0]["contents[].desc"], ["content-a", "content-b"]);
    assert.equal(rowCandidates[0].columns.id, "video-1");

    assert.equal(rowCandidates[1].id, "987654");
    assert.equal(rowCandidates[1].isAd, true);
    assert.equal(rowCandidates[1]["author.privateAccount"], true);
    assert.equal(rowCandidates[1]["authorStats.followerCount"], 200);
    assert.deepEqual(rowCandidates[1]["contents[].desc"], ["fallback-content"]);
    assert.equal(rowCandidates[1]["stats.shareCount"], 55);
    assert.equal(rowCandidates[1].columns["stats.shareCount"], 55);
});

test("returns empty candidates for invalid JSON or payloads without itemList", () => {
    const invalidJsonResponse = {
        endpointPath: "/api/recommend/item_list",
        requestId: "req-invalid",
        requestUrl: "https://www.tiktok.com/api/recommend/item_list",
        status: 200,
        body: "{not json}"
    };

    const missingItemListResponse = {
        endpointPath: "/api/recommend/item_list",
        requestId: "req-missing",
        requestUrl: "https://www.tiktok.com/api/recommend/item_list",
        status: 200,
        body: JSON.stringify({ status_code: 0 })
    };

    assert.deepEqual(extractItemListRowCandidates(invalidJsonResponse), []);
    assert.deepEqual(extractItemListRowCandidates(missingItemListResponse), []);
});

test("supports custom schema mappings passed at runtime", () => {
    const capturedResponse = {
        endpointPath: "/api/recommend/item_list",
        requestId: "req-custom",
        requestUrl: "https://www.tiktok.com/api/recommend/item_list?cursor=77",
        status: 200,
        body: JSON.stringify({
            itemList: [
                {
                    id: "video-2",
                    description: "custom description",
                    contents: [{ text: "part-1" }, { text: "part-2" }],
                    stats: { play_count: "123" }
                }
            ]
        })
    };

    const customMappings = [
        {
            columnName: "itemId",
            type: "string",
            paths: ["id"]
        },
        {
            columnName: "headline",
            type: "string",
            paths: ["description", "desc"]
        },
        {
            columnName: "contentPieces",
            type: "string[]",
            paths: ["contents[].text"]
        },
        {
            columnName: "plays",
            type: "number",
            paths: ["stats.playCount", "stats.play_count"]
        }
    ];

    const rowCandidates = extractItemListRowCandidates(capturedResponse, customMappings);

    assert.equal(rowCandidates.length, 1);
    assert.equal(rowCandidates[0].itemId, "video-2");
    assert.equal(rowCandidates[0].headline, "custom description");
    assert.deepEqual(rowCandidates[0].contentPieces, ["part-1", "part-2"]);
    assert.equal(rowCandidates[0].plays, 123);
    assert.equal(rowCandidates[0].id, undefined);
});

test("loads schema mappings from dedicated json config", () => {
    const schemaConfig = loadCsvColumnSchemaConfig("config/csv-column-mapping.json");

    assert.ok(Array.isArray(schemaConfig.columns));
    assert.ok(schemaConfig.columns.length > 0);
    assert.equal(schemaConfig.columns[0].columnName, "id");
});
