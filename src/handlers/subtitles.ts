import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";
import CommonFormats from "src/CommonFormats.ts";

type Cue = {
  startMs: number;
  endMs: number;
  text: string;
};

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

function pad3(n: number) {
  return n.toString().padStart(3, "0");
}

function msToSrtTime(ms: number) {
  ms = Math.max(0, Math.floor(ms));
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function msToVttTime(ms: number) {
  ms = Math.max(0, Math.floor(ms));
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}

function parseTimeToMs(raw: string) {
  // Supports: HH:MM:SS,mmm   HH:MM:SS.mmm  and ASS: H:MM:SS.cc
  const s = raw.trim();
  const assMatch = s.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (assMatch) {
    const h = Number(assMatch[1]);
    const m = Number(assMatch[2]);
    const sec = Number(assMatch[3]);
    const cs = Number(assMatch[4]);
    return (((h * 60 + m) * 60 + sec) * 1000) + cs * 10;
  }

  const srtMatch = s.match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (srtMatch) {
    const h = Number(srtMatch[1]);
    const m = Number(srtMatch[2]);
    const sec = Number(srtMatch[3]);
    const ms = Number(srtMatch[4].padEnd(3, "0"));
    return (((h * 60 + m) * 60 + sec) * 1000) + ms;
  }

  return 0;
}

function parseSrt(text: string): Cue[] {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\s*\n/g);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trimEnd()).filter(l => l.trim() !== "");
    if (lines.length < 2) continue;
    const timeLine = lines.find(l => l.includes("-->") ) ?? "";
    const parts = timeLine.split("-->").map(s => s.trim());
    if (parts.length < 2) continue;
    const startMs = parseTimeToMs(parts[0]);
    const endMs = parseTimeToMs(parts[1].split(" ")[0]);
    const timeIndex = lines.indexOf(timeLine);
    const textLines = lines.slice(timeIndex + 1);
    cues.push({ startMs, endMs, text: textLines.join("\n") });
  }
  return cues;
}

function parseVtt(text: string): Cue[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const cues: Cue[] = [];

  let i = 0;
  if (lines[0]?.startsWith("WEBVTT")) {
    while (i < lines.length && lines[i].trim() !== "") i++;
  }

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;
    // Optional cue id line
    if (!lines[i].includes("-->")) i++;
    if (i >= lines.length || !lines[i].includes("-->")) continue;

    const timeLine = lines[i++];
    const parts = timeLine.split("-->").map(s => s.trim());
    const startMs = parseTimeToMs(parts[0]);
    const endMs = parseTimeToMs(parts[1].split(" ")[0]);
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i++]);
    }
    cues.push({ startMs, endMs, text: textLines.join("\n") });
  }
  return cues;
}

function parseAss(text: string): Cue[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const cues: Cue[] = [];

  let inEvents = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[Events]")) {
      inEvents = true;
      continue;
    }
    if (!inEvents) continue;
    if (!trimmed.startsWith("Dialogue:")) continue;

    // Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    const rest = trimmed.slice("Dialogue:".length).trim();
    const parts = rest.split(",");
    if (parts.length < 10) continue;
    const startMs = parseTimeToMs(parts[1]);
    const endMs = parseTimeToMs(parts[2]);
    const textPart = parts.slice(9).join(",");
    const cleanText = textPart
      .replace(/\\N/g, "\n")
      .replace(/\{[^}]*\}/g, "")
      .trim();
    cues.push({ startMs, endMs, text: cleanText });
  }

  return cues;
}

function cuesToPlainText(cues: Cue[]) {
  return cues.map(c => c.text).filter(Boolean).join("\n");
}

function plainTextToCues(text: string): Cue[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map(l => l.trimEnd()).filter(l => l.trim() !== "");
  const cues: Cue[] = [];
  let t = 0;
  for (const line of lines) {
    const startMs = t;
    const endMs = t + 2000;
    cues.push({ startMs, endMs, text: line });
    t = endMs;
  }
  if (cues.length === 0) cues.push({ startMs: 0, endMs: 2000, text: "" });
  return cues;
}

function cuesToSrt(cues: Cue[]) {
  return cues.map((c, idx) => {
    return `${idx + 1}\n${msToSrtTime(c.startMs)} --> ${msToSrtTime(c.endMs)}\n${c.text}\n`;
  }).join("\n");
}

function cuesToVtt(cues: Cue[]) {
  const body = cues.map((c) => {
    return `${msToVttTime(c.startMs)} --> ${msToVttTime(c.endMs)}\n${c.text}\n`;
  }).join("\n");
  return `WEBVTT\n\n${body}`;
}

function cuesToAss(cues: Cue[]) {
  const header = `[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = cues.map((c) => {
    // ASS uses centiseconds in time string
    const startCs = Math.floor(c.startMs / 10);
    const endCs = Math.floor(c.endMs / 10);
    const start = `${Math.floor(startCs / 360000)}:${pad2(Math.floor((startCs / 6000) % 60))}:${pad2(Math.floor((startCs / 100) % 60))}.${pad2(startCs % 100)}`;
    const end = `${Math.floor(endCs / 360000)}:${pad2(Math.floor((endCs / 6000) % 60))}:${pad2(Math.floor((endCs / 100) % 60))}.${pad2(endCs % 100)}`;
    const text = c.text.replace(/\n/g, "\\N");
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  }).join("\n");
  return `${header}${events}\n`;
}

const SRT: FileFormat = { name: "SubRip Subtitle", format: "srt", extension: "srt", mime: "text/srt", from: true, to: true, internal: "srt", category: "text", lossless: false };
const VTT: FileFormat = { name: "WebVTT Subtitle", format: "vtt", extension: "vtt", mime: "text/vtt", from: true, to: true, internal: "vtt", category: "text", lossless: false };
const ASS: FileFormat = { name: "Advanced SubStation Alpha", format: "ass", extension: "ass", mime: "text/x-ssa", from: true, to: true, internal: "ass", category: "text", lossless: false };

function parseByInternal(internal: string, text: string): Cue[] {
  if (internal === "srt") return parseSrt(text);
  if (internal === "vtt") return parseVtt(text);
  if (internal === "ass") return parseAss(text);
  throw new Error("Unsupported subtitle format");
}

class subtitlesHandler implements FormatHandler {
  public name = "subtitles";
  public supportedFormats: FileFormat[] = [
    SRT,
    VTT,
    ASS,
    CommonFormats.TEXT.builder("txt").allowFrom().allowTo().markLossless(),
    CommonFormats.JSON.builder("json").allowFrom().allowTo(),
  ];
  public ready = true;

  async init(): Promise<void> {
    this.ready = true;
  }

  async doConvert(inputFiles: FileData[], inputFormat: FileFormat, outputFormat: FileFormat): Promise<FileData[]> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const out: FileData[] = [];

    for (const input of inputFiles) {
      const baseName = input.name.replace(/\.[^.]+$/i, "");

      let cues: Cue[] | null = null;
      if (["srt", "vtt", "ass"].includes(inputFormat.internal)) {
        cues = parseByInternal(inputFormat.internal, decoder.decode(input.bytes));
      } else if (inputFormat.internal === "txt") {
        cues = plainTextToCues(decoder.decode(input.bytes));
      } else if (inputFormat.internal === "json") {
        const parsed = JSON.parse(decoder.decode(input.bytes));
        const list = Array.isArray(parsed) ? parsed : parsed?.cues;
        if (!Array.isArray(list)) throw new Error("Invalid subtitle JSON");
        cues = list.map((c: any) => ({
          startMs: Number(c.startMs ?? 0),
          endMs: Number(c.endMs ?? 0),
          text: String(c.text ?? ""),
        }));
      } else {
        throw new Error("Invalid input format");
      }

      if (outputFormat.internal === "txt") {
        out.push({ name: `${baseName}.txt`, bytes: encoder.encode(cuesToPlainText(cues)) });
        continue;
      }

      if (outputFormat.internal === "json") {
        out.push({
          name: `${baseName}.json`,
          bytes: encoder.encode(JSON.stringify({
            name: input.name,
            cues,
          }, null, 2)),
        });
        continue;
      }

      if (outputFormat.internal === "srt") {
        out.push({ name: `${baseName}.srt`, bytes: encoder.encode(cuesToSrt(cues)) });
        continue;
      }
      if (outputFormat.internal === "vtt") {
        out.push({ name: `${baseName}.vtt`, bytes: encoder.encode(cuesToVtt(cues)) });
        continue;
      }
      if (outputFormat.internal === "ass") {
        out.push({ name: `${baseName}.ass`, bytes: encoder.encode(cuesToAss(cues)) });
        continue;
      }

      throw new Error("Invalid output format");
    }

    return out;
  }
}

export default subtitlesHandler;
