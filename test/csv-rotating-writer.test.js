const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
    createCsvRotatingWriter
} = require("../dist/store/csv-rotating-writer.js");
const {
    loadCsvColumnSchemaConfig
} = require("../dist/schema/csv-schema.js");

test("writes configured default columns to the daily CSV file in schema order", async () => {
    const tempRootDir = await mkdtemp(join(tmpdir(), "tiktok-tracker-csv-"));
    const captureRunId = "run-001";
    const writer = createCsvRotatingWriter(
        tempRootDir,
        loadCsvColumnSchemaConfig("config/csv-column-mapping.json").columns,
        captureRunId,
        () => new Date("2026-05-26T12:00:00.000Z")
    );

    const outputPath = await writer.appendRowCandidates([
        {
            itemIndex: 0,
            sourceEndpoint: "/api/recommend/item_list",
            requestId: "req-1",
            requestUrl: "https://www.tiktok.com/api/recommend/item_list?cursor=1",
            status: 200,
            columns: {
                id: "video-1",
                desc: "hello, world",
                isAd: false,
                "author.nickname": "author-one",
                "author.privateAccount": true,
                "author.uniqueId": "author_one",
                "authorStats.diggCount": 10,
                "authorStats.followerCount": 20,
                "authorStats.followingCount": 30,
                "authorStats.friendCount": 40,
                "authorStats.heart": 50,
                "authorStats.heartCount": 60,
                "authorStats.videoCount": 70,
                "contents[].desc": ["line-a", "line-b"],
                "music.authorName": "music-one",
                "stats.collectCount": 1,
                "stats.commentCount": 2,
                "stats.diggCount": 3,
                "stats.playCount": 4,
                "stats.shareCount": 5
            }
        }
    ]);

    assert.equal(outputPath, join(tempRootDir, "tiktok_2026-05-26.csv"));

    const csvContents = await readFile(outputPath, "utf8");
    const lines = csvContents.trimEnd().split("\n");

    assert.equal(
        lines[0],
        [
            "id",
            "desc",
            "isAd",
            "author.nickname",
            "author.privateAccount",
            "author.uniqueId",
            "authorStats.diggCount",
            "authorStats.followerCount",
            "authorStats.followingCount",
            "authorStats.friendCount",
            "authorStats.heart",
            "authorStats.heartCount",
            "authorStats.videoCount",
            "contents[].desc",
            "music.authorName",
            "stats.collectCount",
            "stats.commentCount",
            "stats.diggCount",
            "stats.playCount",
            "stats.shareCount",
            "capture_run_id",
            "source_endpoint",
            "request_url",
            "fetched_at_utc+1"
        ].join(",")
    );
    assert.equal(
        lines[1],
        [
            "video-1",
            '"hello, world"',
            "false",
            "author-one",
            "true",
            "author_one",
            "10",
            "20",
            "30",
            "40",
            "50",
            "60",
            "70",
            "line-a | line-b",
            "music-one",
            "1",
            "2",
            "3",
            "4",
            "5",
            "run-001",
            "/api/recommend/item_list",
            "https://www.tiktok.com/api/recommend/item_list?cursor=1",
            "2026-05-26T13:00:00.000+01:00"
        ].join(",")
    );
});

test("appends rows without duplicating the header", async () => {
    const tempRootDir = await mkdtemp(join(tmpdir(), "tiktok-tracker-csv-"));
    const captureRunId = "run-001";
    const writer = createCsvRotatingWriter(
        tempRootDir,
        loadCsvColumnSchemaConfig("config/csv-column-mapping.json").columns,
        captureRunId,
        () => new Date("2026-05-26T12:00:00.000Z")
    );

    await writer.appendRowCandidates([
        {
            itemIndex: 0,
            sourceEndpoint: "/api/recommend/item_list",
            requestId: "req-1",
            requestUrl: "https://www.tiktok.com/api/recommend/item_list?cursor=1",
            status: 200,
            columns: { id: "video-1" }
        }
    ]);
    const outputPath = await writer.appendRowCandidates([
        {
            itemIndex: 1,
            sourceEndpoint: "/api/recommend/item_list",
            requestId: "req-2",
            requestUrl: "https://www.tiktok.com/api/recommend/item_list?cursor=2",
            status: 200,
            columns: { id: "video-2" }
        }
    ]);

    const csvContents = await readFile(outputPath, "utf8");
    const lines = csvContents.trimEnd().split("\n");

    assert.equal(lines.length, 3);
    assert.equal(lines[1].split(",")[0], "video-1");
    assert.equal(lines[2].split(",")[0], "video-2");
});

