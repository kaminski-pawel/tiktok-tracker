const assert = require("node:assert/strict");
const test = require("node:test");

const {
    createNetworkResponseLifecycleTracker
} = require("../dist/chrome/network-listener.js");

test("captures repeated recommend item_list responses on loadingFinished", async () => {
    const sendCommandCalls = [];
    const capturedResponses = [];
    const tracker = createNetworkResponseLifecycleTracker({
        enabledEndpointPaths: ["/api/recommend/item_list"],
        sendCommand: async (method, params, sessionId) => {
            sendCommandCalls.push({ method, params, sessionId });
            const requestId = params.requestId;
            return {
                body: JSON.stringify({ requestId }),
                base64Encoded: false
            };
        },
        onCapturedResponse: async (response) => {
            capturedResponses.push(response);
        }
    });

    await tracker.handleEvent({
        method: "Network.responseReceived",
        sessionId: "session-1",
        params: {
            requestId: "req-1",
            response: {
                url: "https://www.tiktok.com/api/recommend/item_list?cursor=1",
                status: 200
            }
        }
    });
    await tracker.handleEvent({
        method: "Network.loadingFinished",
        sessionId: "session-1",
        params: {
            requestId: "req-1"
        }
    });

    await tracker.handleEvent({
        method: "Network.responseReceived",
        sessionId: "session-1",
        params: {
            requestId: "req-2",
            response: {
                url: "https://www.tiktok.com/api/recommend/item_list?cursor=2",
                status: 200
            }
        }
    });
    await tracker.handleEvent({
        method: "Network.loadingFinished",
        sessionId: "session-1",
        params: {
            requestId: "req-2"
        }
    });

    assert.equal(sendCommandCalls.length, 2);
    assert.deepEqual(sendCommandCalls.map((call) => call.method), ["Network.getResponseBody", "Network.getResponseBody"]);
    assert.deepEqual(sendCommandCalls.map((call) => call.sessionId), ["session-1", "session-1"]);
    assert.deepEqual(sendCommandCalls.map((call) => call.params), [{ requestId: "req-1" }, { requestId: "req-2" }]);
    assert.deepEqual(capturedResponses.map((response) => response.requestId), ["req-1", "req-2"]);
    assert.deepEqual(capturedResponses.map((response) => response.body), [
        JSON.stringify({ requestId: "req-1" }),
        JSON.stringify({ requestId: "req-2" })
    ]);
    assert.deepEqual(capturedResponses.map((response) => response.requestUrl), [
        "https://www.tiktok.com/api/recommend/item_list?cursor=1",
        "https://www.tiktok.com/api/recommend/item_list?cursor=2"
    ]);
    assert.deepEqual(capturedResponses.map((response) => response.endpointPath), [
        "/api/recommend/item_list",
        "/api/recommend/item_list"
    ]);
});
