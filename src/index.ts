import { connectToChrome } from "./chrome/attach";
import { loadRuntimeConfig } from "./config";

async function main(): Promise<void> {
    const runtimeConfig = loadRuntimeConfig(process.env);
    const chromeSession = await connectToChrome(runtimeConfig);

    process.stdout.write(
        [
            "TikTok tracker runtime initialized.",
            `Mode: ${chromeSession.mode}`,
            `DevTools endpoint: ${chromeSession.devToolsBaseUrl}`
        ].join("\n") + "\n"
    );

    if (chromeSession.mode === "managed-launch") {
        process.on("SIGINT", () => {
            void chromeSession.close().finally(() => {
                process.exit(0);
            });
        });
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to initialize tracker runtime: ${message}\n`);
    process.exit(1);
});
