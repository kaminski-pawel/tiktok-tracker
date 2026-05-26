import { randomUUID } from "node:crypto";

import { connectToChrome } from "./chrome/attach";
import { startNetworkResponseListener } from "./chrome/network-listener";
import { loadRuntimeConfig } from "./config";
import { extractItemListRowCandidates } from "./normalize/extractor";
import { loadCsvColumnSchemaConfig } from "./schema/csv-schema";
import { createCsvRotatingWriter } from "./store/csv-rotating-writer";
import { createRawJsonArchiveWriter } from "./store/raw-json-archive";
import { createResponseBodyDeduplicator } from "./store/response-body-deduplicator";

async function main(): Promise<void> {
    const runtimeConfig = loadRuntimeConfig(process.env);
    const captureRunId = randomUUID();
    const csvColumnSchemaConfig = loadCsvColumnSchemaConfig(runtimeConfig.csvColumnMappingConfigPath);
    const responseBodyDeduplicator = createResponseBodyDeduplicator();
    const rawJsonArchiveWriter = createRawJsonArchiveWriter(runtimeConfig.rawJsonArchiveRootDir);
    const csvWriter = createCsvRotatingWriter(
        runtimeConfig.csvOutputRootDir,
        csvColumnSchemaConfig.columns,
        captureRunId
    );
    const chromeSession = await connectToChrome(runtimeConfig);
    const stopNetworkListener = await startNetworkResponseListener(
        chromeSession.webSocketDebuggerUrl,
        runtimeConfig.enabledEndpointPaths,
        async (capturedResponse) => {
            if (!responseBodyDeduplicator.shouldCapture(capturedResponse)) {
                process.stdout.write(
                    [
                        "Skipped duplicate endpoint response.",
                        `Endpoint: ${capturedResponse.endpointPath}`,
                        `URL: ${capturedResponse.requestUrl}`,
                        `Request id: ${capturedResponse.requestId}`
                    ].join("\n") + "\n"
                );
                return;
            }

            const archivedFilePath = await rawJsonArchiveWriter.persistMatchedResponse(capturedResponse);
            const rowCandidates = extractItemListRowCandidates(capturedResponse, csvColumnSchemaConfig.columns);
            const csvFilePaths = await csvWriter.appendRowCandidates(rowCandidates);
            process.stdout.write(
                [
                    "Captured endpoint response.",
                    `Endpoint: ${capturedResponse.endpointPath}`,
                    `Status: ${capturedResponse.status}`,
                    `URL: ${capturedResponse.requestUrl}`,
                    `Archived JSON: ${archivedFilePath}`,
                    `Extracted row candidates: ${rowCandidates.length}`,
                    `CSV output: ${csvFilePaths.length > 0 ? csvFilePaths.join(", ") : "no rows written"}`
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
            `Raw JSON archive root: ${runtimeConfig.rawJsonArchiveRootDir}`,
            `CSV output root: ${runtimeConfig.csvOutputRootDir}`,
            `CSV column mapping config: ${runtimeConfig.csvColumnMappingConfigPath}`,
            `Capture run id: ${captureRunId}`
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
