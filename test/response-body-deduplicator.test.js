const assert = require("node:assert/strict");
const test = require("node:test");

const {
    createResponseBodyDeduplicator
} = require("../dist/store/response-body-deduplicator.js");

test("deduplicates repeated captures with the same response body hash", () => {
    const deduplicator = createResponseBodyDeduplicator();

    const firstResponse = {
        endpointPath: "/api/recommend/item_list",
        requestId: "req-1",
        requestUrl: "https://www.tiktok.com/api/recommend/item_list?cursor=1",
        status: 200,
        body: JSON.stringify({ itemList: [{ id: "video-1" }] })
    };

    const duplicateBodyDifferentRequest = {
        endpointPath: "/api/recommend/item_list",
        requestId: "req-2",
        requestUrl: "https://www.tiktok.com/api/recommend/item_list?cursor=2",
        status: 200,
        body: JSON.stringify({ itemList: [{ id: "video-1" }] })
    };

    const differentBody = {
        endpointPath: "/api/recommend/item_list",
        requestId: "req-3",
        requestUrl: "https://www.tiktok.com/api/recommend/item_list?cursor=3",
        status: 200,
        body: JSON.stringify({ itemList: [{ id: "video-2" }] })
    };

    assert.equal(deduplicator.shouldCapture(firstResponse), true);
    assert.equal(deduplicator.shouldCapture(duplicateBodyDifferentRequest), false);
    assert.equal(deduplicator.shouldCapture(differentBody), true);
});