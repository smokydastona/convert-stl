import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import CommonFormats from "src/CommonFormats.ts";

class txtToInfiniteCraftHandler implements FormatHandler {

    public name: string = "txtToInfiniteCraft";
    public supportedFormats?: FileFormat[];
    public ready: boolean = false;

    async init () {
        this.supportedFormats = [
            CommonFormats.TEXT.supported("text", true, true),
            {
                name: "Infinite Craft Save File",
                format: "ic",
                extension: "ic",
                mime: "application/x-infinite-craft-ic",
                from: true,
                to: true,
                internal: "ic",
                category: "archive",
                lossless: false
            },
        ];
        this.ready = true;
    }

    async doConvert (
        inputFiles: FileData[],
        inputFormat: FileFormat,
        outputFormat: FileFormat
    ): Promise<FileData[]> {
        const inputFile = inputFiles[0];

        if (inputFormat.internal === "text" && outputFormat.internal === "ic") {
            const text = new TextDecoder().decode(inputFile.bytes);
            const words = text
                .split(/[^a-zA-Z0-9']+/)
                .filter(Boolean);

            const emojis = ["💧", "🔥", "🌬️", "🌍", "⚡", "❄️", "🌟", "🌈", "🌊", "🍃"];
            function getRandomEmoji(): string {
                return emojis[Math.floor(Math.random() * emojis.length)];
            }

            const jsonData = {
                name: "Save 1",
                version: "1.0",
                created: Date.now(),
                updated: 0,
                instances: [] as any[],
                items: words.map((word, index) => ({
                    id: index,
                    text: word,
                    emoji: getRandomEmoji(),
                })),
            };

            const outputBytes = new TextEncoder().encode(JSON.stringify(jsonData, null, 2));
            const cs = new CompressionStream("gzip");
            const inputStream = new Response(outputBytes).body!;
            const compressedStream = inputStream.pipeThrough(cs);
            const compressedBytes = new Uint8Array(await new Response(compressedStream).arrayBuffer());

            const outputFileName = inputFile.name.replace(/\.txt$/i, ".ic");
            return [{ name: outputFileName, bytes: compressedBytes }];
        }

        if (inputFormat.internal === "ic" && outputFormat.internal === "text") {
            const ds = new DecompressionStream("gzip");
            const bytes = new Uint8Array(inputFile.bytes);
            const decompressedStream = new Response(new Blob([bytes])).body!.pipeThrough(ds);
            const jsonText = await new Response(decompressedStream).text();
            const parsed = JSON.parse(jsonText);

            const items = Array.isArray(parsed?.items) ? parsed.items : [];
            const outText = items
                .map((it: any) => String(it?.text ?? "").trim())
                .filter(Boolean)
                .join("\n");

            const outBytes = new TextEncoder().encode(outText);
            const outputFileName = inputFile.name.replace(/\.ic$/i, ".txt");
            return [{ name: outputFileName, bytes: outBytes }];
        }

        throw new Error("Unsupported conversion for txtToInfiniteCraft");
    }

}

export default txtToInfiniteCraftHandler;