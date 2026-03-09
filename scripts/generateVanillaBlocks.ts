import fs from "node:fs";
import path from "node:path";

type BlockStateDefinition = {
  variants?: Record<string, unknown>;
  multipart?: Array<{ when?: unknown; apply?: unknown }>;
};

type OutputEntry = {
  name: string;
  states: Array<Record<string, string>>;
};

type CliArgs = {
  blockstatesDir: string;
  outFile: string;
  placeholders: number;
  placeholderNamespace: string;
};

const EXCLUDED_BLOCKS = new Set([
  // Common technical / non-buildable / special-case blocks.
  "barrier",
  "light",
  "structure_block",
  "structure_void",
  "jigsaw",
  "command_block",
  "chain_command_block",
  "repeating_command_block",
  "debug_stick",
]);

function shouldIncludeWaterlogged(block: string): boolean {
  // Heuristic: only include waterlogged=true when it typically matters visually.
  return (
    block.includes("slab") ||
    block.includes("stairs") ||
    block.includes("trapdoor") ||
    block.includes("fence") ||
    block.includes("wall") ||
    block.includes("sign") ||
    block.includes("leaves") ||
    block.includes("lantern") ||
    block.includes("door")
  );
}

function parseVariantKey(key: string): Record<string, string> {
  const trimmed = key.trim();
  if (!trimmed) return {};
  const out: Record<string, string> = {};
  for (const part of trimmed.split(",")) {
    const [k, v] = part.split("=");
    if (!k || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function stableStateKey(state: Record<string, string>): string {
  const entries = Object.entries(state).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join(",");
}

function expandWhenValue(value: unknown): string[] {
  if (typeof value === "string") {
    // Mojang uses "a|b" to mean OR in multipart.
    return value.split("|").map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const v of value) out.push(...expandWhenValue(v));
    return out;
  }
  return [];
}

function cartesianProduct<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, curr) => acc.flatMap((a) => curr.map((b) => [...a, b])), [[]]);
}

function expandWhenClause(when: unknown): Array<Record<string, string>> {
  // Returns a list of state-constraints implied by `when`.
  // `when` can be:
  // - { prop: "value" , ... }
  // - { OR: [ {...}, {...} ] }
  // - [ {...}, {...} ] (rare; treat as OR)
  if (!when) return [{}];

  if (Array.isArray(when)) {
    return when.flatMap((w) => expandWhenClause(w));
  }

  if (typeof when === "object") {
    const obj = when as Record<string, unknown>;

    if (Array.isArray(obj.OR)) {
      return obj.OR.flatMap((w) => expandWhenClause(w));
    }

    const props: Array<[string, string[]]> = [];
    for (const [k, v] of Object.entries(obj)) {
      if (k === "OR") continue;
      const values = expandWhenValue(v);
      if (values.length === 0) continue;
      props.push([k, values]);
    }

    if (props.length === 0) return [{}];

    const combos = cartesianProduct(props.map(([k, values]) => values.map((value) => ({ k, value }))));
    return combos.map((combo) => {
      const state: Record<string, string> = {};
      for (const { k, value } of combo as any) state[k] = value;
      return state;
    });
  }

  return [{}];
}

function normalizeWaterlogged(blockName: string, state: Record<string, string>): Record<string, string> | null {
  if (!Object.prototype.hasOwnProperty.call(state, "waterlogged")) return state;
  const allowTrue = shouldIncludeWaterlogged(blockName);
  if (!allowTrue && state.waterlogged === "true") return null;
  if (!allowTrue && state.waterlogged !== "false") return { ...state, waterlogged: "false" };
  return state;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    blockstatesDir: "",
    outFile: "vanillaBlocks.json",
    placeholders: 0,
    placeholderNamespace: "mod",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--blockstatesDir") args.blockstatesDir = argv[++i] ?? "";
    else if (a === "--out") args.outFile = argv[++i] ?? "vanillaBlocks.json";
    else if (a === "--placeholders") args.placeholders = Number(argv[++i] ?? "0") || 0;
    else if (a === "--placeholderNamespace") args.placeholderNamespace = argv[++i] ?? "mod";
  }

  if (!args.blockstatesDir) {
    throw new Error("Missing --blockstatesDir. Point it at assets/minecraft/blockstates/*.json extracted from the jar.");
  }

  return args;
}

function generateFromDir(blockstatesDir: string): OutputEntry[] {
  const files = fs.readdirSync(blockstatesDir);
  const output: OutputEntry[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const blockName = file.slice(0, -".json".length);
    if (EXCLUDED_BLOCKS.has(blockName)) continue;

    const fullName = `minecraft:${blockName}`;
    const raw = fs.readFileSync(path.join(blockstatesDir, file), "utf8");
    const def = JSON.parse(raw) as BlockStateDefinition;

    const states: Array<Record<string, string>> = [];

    if (def.variants) {
      for (const key of Object.keys(def.variants)) {
        const s = parseVariantKey(key);
        const normalized = normalizeWaterlogged(blockName, s);
        if (normalized) states.push(normalized);
      }
    }

    if (def.multipart) {
      for (const part of def.multipart) {
        const whens = expandWhenClause(part.when);
        for (const w of whens) {
          const normalized = normalizeWaterlogged(blockName, w);
          if (normalized) states.push(normalized);
        }
      }
    }

    // If no states discovered, emit empty state list.
    // Otherwise dedupe.
    const unique = new Map<string, Record<string, string>>();
    for (const s of states) unique.set(stableStateKey(s), s);

    output.push({
      name: fullName,
      states: Array.from(unique.values()),
    });
  }

  return output;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = generateFromDir(args.blockstatesDir);

  for (let i = 1; i <= args.placeholders; i++) {
    entries.push({
      name: `${args.placeholderNamespace}:placeholder_${i}`,
      states: [],
    });
  }

  fs.writeFileSync(args.outFile, JSON.stringify(entries, null, 2));
  console.log(`Wrote ${entries.length} blocks to ${args.outFile}`);
}

main();
