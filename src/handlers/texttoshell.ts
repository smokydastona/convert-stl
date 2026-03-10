import CommonFormats from "src/CommonFormats.ts";
import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

class textToShellHandler implements FormatHandler {

  public name: string = "textToSH";

  public supportedFormats: FileFormat[] = [
    CommonFormats.TEXT.supported("txt", true, true, true),
    CommonFormats.SH.supported("sh", true, true, true)
  ];

  public ready: boolean = false;

  async init() {
    this.ready = true;
  }

  async doConvert(
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    const outputFiles: FileData[] = [];

    for (const file of inputFiles) {
      const baseName = file.name.split(".").slice(0, -1).join(".") || file.name;

      // TXT -> SH
      if (inputFormat.internal === "txt" && outputFormat.internal === "sh") {
        const text = new TextDecoder().decode(file.bytes)
          .replaceAll("\\", "\\\\")
          .replaceAll("\"", "\\\"");

        const script = `#!/bin/sh\necho "${text}"`;
        outputFiles.push({
          bytes: new TextEncoder().encode(script),
          name: `${baseName}.${outputFormat.extension}`
        });
        continue;
      }

      // SH -> TXT (best-effort: preserve the script as text)
      if (inputFormat.internal === "sh" && outputFormat.internal === "txt") {
        const text = new TextDecoder().decode(file.bytes);
        outputFiles.push({
          bytes: new TextEncoder().encode(text),
          name: `${baseName}.txt`
        });
        continue;
      }

      throw new Error("Invalid output format.");
    }

    return outputFiles;
  }
}

export default textToShellHandler;
