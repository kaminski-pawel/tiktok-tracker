import { connectToChrome } from "./chrome/attach";
import { startNetworkResponseListener } from "./chrome/network-listener";
import { loadRuntimeConfig } from "./config";
import { extractItemListRowCandidates } from "./normalize/extractor";
import { createRawJsonArchiveWriter } from "./store/raw-json-archive";

async function main(): Promise<void> {
    const runtimeConfig = loadRuntimeConfig(process.env);
    const rawJsonArchiveWriter = createRawJsonArchiveWriter(runtimeConfig.rawJsonArchiveRootDir);
    const chromeSession = await connectToChrome(runtimeConfig);
    const stopNetworkListener = await startNetworkResponseListener(
        chromeSession.webSocketDebuggerUrl,
        runtimeConfig.enabledEndpointPaths,
        async (capturedResponse) => {
            const archivedFilePath = await rawJsonArchiveWriter.persistMatchedResponse(capturedResponse);
            const rowCandidates = extractItemListRowCandidates(capturedResponse);
            process.stdout.write(
                [
                    "Captured endpoint response.",
                    `Endpoint: ${capturedResponse.endpointPath}`,
                    `Status: ${capturedResponse.status}`,
                    `URL: ${capturedResponse.requestUrl}`,
                    `Archived JSON: ${archivedFilePath}`,
                    `Extracted row candidates: ${rowCandidates.length}`
                ].join("\n") + "\n"
            );
        }
    );

    let shuttingDown = false;
    const shutdown = (): void => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        void stopNetworkListener()
            .catch(() => {
                // Ignore cleanup failures during shutdown.
            })
            .then(() => chromeSession.close())
            .finally(() => {
                process.exit(0);
            });
    };

    process.stdout.write(
        [
            "TikTok tracker runtime initialized.",
            `Mode: ${chromeSession.mode}`,
            `DevTools endpoint: ${chromeSession.devToolsBaseUrl}`,
            `Enabled endpoints: ${runtimeConfig.enabledEndpointPaths.join(", ")}`,
            `Raw JSON archive root: ${runtimeConfig.rawJsonArchiveRootDir}`
        ].join("\n") + "\n"
    );

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to initialize tracker runtime: ${message}\n`);
    process.exit(1);
});
