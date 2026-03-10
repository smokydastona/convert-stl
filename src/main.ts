import type { FileFormat, FileData, FormatHandler, ConvertPathNode } from "./FormatHandler.js";
import normalizeMimeType from "./normalizeMimeType.js";
import handlers from "./handlers";
import { TraversionGraph } from "./TraversionGraph.js";

// Expose the Vite base path for legacy scripts that can't access import.meta.env.
(globalThis as any).__CONVERT_BASE__ = import.meta.env.BASE_URL;

/** Files currently selected for conversion */
let selectedFiles: File[] = [];
/**
 * Whether to use "simple" mode.
 * - In **simple** mode, the input/output lists are grouped by file format.
 * - In **advanced** mode, these lists are grouped by format handlers, which
 *   requires the user to manually select the tool that processes the output.
 */
let simpleMode: boolean = true;

/** Handlers that support conversion from any formats. */
const conversionsFromAnyInput: ConvertPathNode[] = handlers
.filter(h => h.supportAnyInput && h.supportedFormats)
.flatMap(h => h.supportedFormats!
  .filter(f => f.to)
  .map(f => ({ handler: h, format: f})))

const ui = {
  fileInput: document.querySelector("#file-input") as HTMLInputElement,
  fileSelectArea: document.querySelector("#file-area") as HTMLDivElement,
  convertButton: document.querySelector("#convert-button") as HTMLButtonElement,
  modeToggleButton: document.querySelector("#mode-button") as HTMLButtonElement,
  inputList: document.querySelector("#from-list") as HTMLDivElement,
  outputList: document.querySelector("#to-list") as HTMLDivElement,
  inputSearch: document.querySelector("#search-from") as HTMLInputElement,
  outputSearch: document.querySelector("#search-to") as HTMLInputElement,
  popupBox: document.querySelector("#popup") as HTMLDivElement,
  popupBackground: document.querySelector("#popup-bg") as HTMLDivElement
};

/**
 * Filters a list of butttons to exclude those not matching a substring.
 * @param list Button list (div) to filter.
 * @param string Substring for which to search.
 */
const filterButtonList = (list: HTMLDivElement, string: string) => {
  for (const button of Array.from(list.children)) {
    if (!(button instanceof HTMLButtonElement)) continue;
    const formatIndex = button.getAttribute("format-index");
    let hasExtension = false;
    if (formatIndex) {
      const format = allOptions[parseInt(formatIndex)];
      hasExtension = format?.format.extension.toLowerCase().includes(string);
    }
    const hasText = button.textContent.toLowerCase().includes(string);
    if (!hasExtension && !hasText) {
      button.style.display = "none";
    } else {
      button.style.display = "";
    }
  }
}

/**
 * Handles search box input by filtering its parent container.
 * @param event Input event from an {@link HTMLInputElement}
 */
const searchHandler = (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  const targetParentList = target.parentElement?.querySelector(".format-list");
  if (!(targetParentList instanceof HTMLDivElement)) return;

  const string = target.value.toLowerCase();
  filterButtonList(targetParentList, string);
};

// Assign search handler to both search boxes
ui.inputSearch.oninput = searchHandler;
ui.outputSearch.oninput = searchHandler;

// Map clicks in the file selection area to the file input element
ui.fileSelectArea.onclick = () => {
  ui.fileInput.click();
};

/**
 * Validates and stores user selected files. Works for both manual
 * selection and file drag-and-drop.
 * @param event Either a file input element's "change" event,
 * or a "drop" event.
 */
const fileSelectHandler = (event: Event) => {

  let inputFiles;

  if (event instanceof DragEvent) {
    inputFiles = event.dataTransfer?.files;
    if (inputFiles) event.preventDefault();
  } else if (event instanceof ClipboardEvent) {
    inputFiles = event.clipboardData?.files;
  } else {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    inputFiles = target.files;
  }

  if (!inputFiles) return;
  const files = Array.from(inputFiles);
  if (files.length === 0) return;

  if (files.some(c => c.type !== files[0].type)) {
    return alert("All input files must be of the same type.");
  }
  files.sort((a, b) => a.name === b.name ? 0 : (a.name < b.name ? -1 : 1));
  selectedFiles = files;

  ui.fileSelectArea.innerHTML = `<h2>
    ${files[0].name}
    ${files.length > 1 ? `<br>... and ${files.length - 1} more` : ""}
  </h2>`;

  // Common MIME type adjustments (to match "mime" library)
  let mimeType = normalizeMimeType(files[0].type);

  const fileExtension = files[0].name.split(".").pop()?.toLowerCase();

  // Find all buttons matching the input MIME type.
  const buttonsMatchingMime = Array.from(ui.inputList.children).filter(button => {
    if (!(button instanceof HTMLButtonElement)) return false;
    return button.getAttribute("mime-type") === mimeType;
  }) as HTMLButtonElement[];
  // If there are multiple, find one with a matching extension too
  let inputFormatButton: HTMLButtonElement;
  if (buttonsMatchingMime.length > 1) {
    inputFormatButton = buttonsMatchingMime.find(button => {
      const formatIndex = button.getAttribute("format-index");
      if (!formatIndex) return;
      const format = allOptions[parseInt(formatIndex)];
      return format.format.extension === fileExtension;
    }) || buttonsMatchingMime[0];
  } else {
    inputFormatButton = buttonsMatchingMime[0];
  }
  // Click button with matching MIME type.
  if (mimeType && inputFormatButton instanceof HTMLButtonElement) {
    inputFormatButton.click();
    ui.inputSearch.value = mimeType;
    filterButtonList(ui.inputList, ui.inputSearch.value);
    return;
  }

  // Fall back to matching format by file extension if MIME type wasn't found.
  const buttonExtension = Array.from(ui.inputList.children).find(button => {
    if (!(button instanceof HTMLButtonElement)) return false;
    const formatIndex = button.getAttribute("format-index");
    if (!formatIndex) return;
    const format = allOptions[parseInt(formatIndex)];
    return format.format.extension.toLowerCase() === fileExtension;
  });
  if (buttonExtension instanceof HTMLButtonElement) {
    buttonExtension.click();
    ui.inputSearch.value = buttonExtension.getAttribute("mime-type") || "";
  } else {
    ui.inputSearch.value = fileExtension || "";
  }

  filterButtonList(ui.inputList, ui.inputSearch.value);

};

// Add the file selection handler to both the file input element and to
// the window as a drag-and-drop event, and to the clipboard paste event.
ui.fileInput.addEventListener("change", fileSelectHandler);
window.addEventListener("drop", fileSelectHandler);
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("paste", fileSelectHandler);

/**
 * Display an on-screen popup.
 * @param html HTML content of the popup box.
 */
window.showPopup = function (html: string) {
  ui.popupBox.innerHTML = html;
  ui.popupBox.style.display = "block";
  ui.popupBackground.style.display = "block";
}
/**
 * Hide the on-screen popup.
 */
window.hidePopup = function () {
  ui.popupBox.style.display = "none";
  ui.popupBackground.style.display = "none";
}

const allOptions: Array<{ format: FileFormat, handler: FormatHandler }> = [];

window.supportedFormatCache = new Map();
window.traversionGraph = new TraversionGraph();

window.printSupportedFormatCache = () => {
  const entries = [];
  for (const entry of window.supportedFormatCache) {
    entries.push(entry);
  }
  return JSON.stringify(entries, null, 2);
}


async function buildOptionList () {

  function getLargestSccIdentifiers(graphData: { nodes: { identifier: string; edges: number[] }[]; edges: { from: { index: number }; to: { index: number } }[] }) {
    const nodeCount = graphData.nodes.length;
    const adj: number[][] = Array.from({ length: nodeCount }, () => []);
    const radj: number[][] = Array.from({ length: nodeCount }, () => []);

    for (const e of graphData.edges) {
      adj[e.from.index].push(e.to.index);
      radj[e.to.index].push(e.from.index);
    }

    const visited = new Uint8Array(nodeCount);
    const order: number[] = [];

    for (let start = 0; start < nodeCount; start++) {
      if (visited[start]) continue;

      visited[start] = 1;
      const stack: number[] = [start];
      const iters: number[] = [0];

      while (stack.length) {
        const v = stack[stack.length - 1];
        const i = iters[iters.length - 1];
        if (i < adj[v].length) {
          const next = adj[v][i];
          iters[iters.length - 1] = i + 1;
          if (!visited[next]) {
            visited[next] = 1;
            stack.push(next);
            iters.push(0);
          }
        } else {
          stack.pop();
          iters.pop();
          order.push(v);
        }
      }
    }

    const comp = new Int32Array(nodeCount);
    comp.fill(-1);
    const compSizes: number[] = [];
    let compId = 0;

    for (let k = order.length - 1; k >= 0; k--) {
      const start = order[k];
      if (comp[start] !== -1) continue;
      let size = 0;
      const queue: number[] = [start];
      comp[start] = compId;
      while (queue.length) {
        const v = queue.pop()!;
        size++;
        for (const next of radj[v]) {
          if (comp[next] === -1) {
            comp[next] = compId;
            queue.push(next);
          }
        }
      }
      compSizes.push(size);
      compId++;
    }

    if (nodeCount === 0) return new Set<string>();

    let largest = 0;
    for (let i = 1; i < compSizes.length; i++) {
      if (compSizes[i] > compSizes[largest]) largest = i;
    }

    const identifiers = new Set<string>();
    for (let i = 0; i < nodeCount; i++) {
      if (comp[i] === largest) identifiers.add(graphData.nodes[i].identifier);
    }
    return identifiers;
  }

  allOptions.length = 0;
  ui.inputList.innerHTML = "";
  ui.outputList.innerHTML = "";

  for (const handler of handlers) {
    if (!window.supportedFormatCache.has(handler.name)) {
      console.warn(`Cache miss for formats of handler "${handler.name}".`);
      try {
        await handler.init();
      } catch (_) { continue; }
      if (handler.supportedFormats) {
        window.supportedFormatCache.set(handler.name, handler.supportedFormats);
        console.info(`Updated supported format cache for "${handler.name}".`);
      }
    }
    const supportedFormats = window.supportedFormatCache.get(handler.name);
    if (!supportedFormats) {
      console.warn(`Handler "${handler.name}" doesn't support any formats.`);
      continue;
    }
    // Handled below after we enforce reachability.
  }

  // Enforce full reachability by pruning to the largest strongly connected component.
  // This guarantees every remaining format can reach every other.
  {
    const tmpGraph = new TraversionGraph();
    tmpGraph.init(window.supportedFormatCache, handlers);
    const allowedIdentifiers = getLargestSccIdentifiers(tmpGraph.getData());
    const total = tmpGraph.getData().nodes.length;
    if (allowedIdentifiers.size !== total) {
      console.warn(`Enforcing full reachability: keeping ${allowedIdentifiers.size}/${total} formats (largest strongly connected component).`);
      const filtered = new Map<string, FileFormat[]>();
      for (const [handlerName, formats] of window.supportedFormatCache) {
        filtered.set(handlerName, formats.filter(f => allowedIdentifiers.has(f.mime + `(${f.format})`)));
      }
      window.supportedFormatCache = filtered;
    }
  }

  // Build the final graph and UI options from the pruned cache.
  window.traversionGraph.init(window.supportedFormatCache, handlers);

  for (const handler of handlers) {
    const supportedFormats = window.supportedFormatCache.get(handler.name);
    if (!supportedFormats) continue;

    for (const format of supportedFormats) {
      if (!format.mime) continue;

      allOptions.push({ format, handler });

      // In simple mode, display each input/output format only once
      let addToInputs = true, addToOutputs = true;
      if (simpleMode) {
        addToInputs = !Array.from(ui.inputList.children).some(c => {
          const currFormat = allOptions[parseInt(c.getAttribute("format-index") || "")]?.format;
          return currFormat?.mime === format.mime && currFormat?.format === format.format;
        });
        addToOutputs = !Array.from(ui.outputList.children).some(c => {
          const currFormat = allOptions[parseInt(c.getAttribute("format-index") || "")]?.format;
          return currFormat?.mime === format.mime && currFormat?.format === format.format;
        });
        if ((!format.from || !addToInputs) && (!format.to || !addToOutputs)) continue;
      }

      const newOption = document.createElement("button");
      newOption.setAttribute("format-index", (allOptions.length - 1).toString());
      newOption.setAttribute("mime-type", format.mime);

      const formatDescriptor = format.format.toUpperCase();
      if (simpleMode) {
        // Hide any handler-specific information in simple mode
        const cleanName = format.name
          .split("(").join(")").split(")")
          .filter((_, i) => i % 2 === 0)
          .filter(c => c != "")
          .join(" ");
        newOption.appendChild(document.createTextNode(`${formatDescriptor} - ${cleanName} (${format.mime})`));
      } else {
        newOption.appendChild(document.createTextNode(`${formatDescriptor} - ${format.name} (${format.mime}) ${handler.name}`));
      }

      const clickHandler = (event: Event) => {
        if (!(event.target instanceof HTMLButtonElement)) return;
        const targetParent = event.target.parentElement;
        const previous = targetParent?.getElementsByClassName("selected")?.[0];
        if (previous) previous.className = "";
        event.target.className = "selected";
        const allSelected = document.getElementsByClassName("selected");
        if (allSelected.length === 2) {
          ui.convertButton.className = "";
        } else {
          ui.convertButton.className = "disabled";
        }
      };

      if (format.from && addToInputs) {
        const clone = newOption.cloneNode(true) as HTMLButtonElement;
        clone.onclick = clickHandler;
        ui.inputList.appendChild(clone);
      }
      if (format.to && addToOutputs) {
        const clone = newOption.cloneNode(true) as HTMLButtonElement;
        clone.onclick = clickHandler;
        ui.outputList.appendChild(clone);
      }
    }
  }

  filterButtonList(ui.inputList, ui.inputSearch.value);
  filterButtonList(ui.outputList, ui.outputSearch.value);

  window.hidePopup();

}

(async () => {
  try {
    const cacheJSON = await fetch("cache.json").then(r => r.json());
    window.supportedFormatCache = new Map(cacheJSON);
  } catch {
    console.warn(
      "Missing supported format precache.\n\n" +
      "Consider saving the output of printSupportedFormatCache() to cache.json."
    );
  } finally {
    await buildOptionList();
    console.log("Built initial format list.");
  }
})();

ui.modeToggleButton.addEventListener("click", () => {
  simpleMode = !simpleMode;
  if (simpleMode) {
    ui.modeToggleButton.textContent = "Advanced mode";
    document.body.style.setProperty("--highlight-color", "#1C77FF");
  } else {
    ui.modeToggleButton.textContent = "Simple mode";
    document.body.style.setProperty("--highlight-color", "#FF6F1C");
  }
  buildOptionList();
});

let deadEndAttempts: ConvertPathNode[][];

async function attemptConvertPath (files: FileData[], path: ConvertPathNode[]) {

  const pathString = path.map(c => c.format.format).join(" → ");

  // Exit early if we've encountered a known dead end
  for (const deadEnd of deadEndAttempts) {
    let isDeadEnd = true;
    for (let i = 0; i < deadEnd.length; i++) {
      if (path[i] === deadEnd[i]) continue;
      isDeadEnd = false;
      break;
    }
    if (isDeadEnd) {
      const deadEndString = deadEnd.slice(-2).map(c => c.format.format).join(" → ");
      console.warn(`Skipping ${pathString} due to dead end near ${deadEndString}.`);
      return null;
    }
  }

  ui.popupBox.innerHTML = `<h2>Finding conversion route...</h2>
    <p>Trying <b>${pathString}</b>...</p>`;

  for (let i = 0; i < path.length - 1; i ++) {
    const handler = path[i + 1].handler;
    try {
      let supportedFormats = window.supportedFormatCache.get(handler.name);
      if (!handler.ready) {
        await handler.init();
        if (!handler.ready) throw `Handler "${handler.name}" not ready after init.`;
        if (handler.supportedFormats) {
          window.supportedFormatCache.set(handler.name, handler.supportedFormats);
          supportedFormats = handler.supportedFormats;
        }
      }
      if (!supportedFormats) throw `Handler "${handler.name}" doesn't support any formats.`;
      const inputFormat = supportedFormats.find(c =>
        c.from
        && c.mime === path[i].format.mime
        && c.format === path[i].format.format
      )!;
      files = (await Promise.all([
        handler.doConvert(files, inputFormat, path[i + 1].format),
        // Ensure that we wait long enough for the UI to update
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      ]))[0];
      if (files.some(c => !c.bytes.length)) throw "Output is empty.";
    } catch (e) {

      console.log(path.map(c => c.format.format));
      console.error(handler.name, `${path[i].format.format} → ${path[i + 1].format.format}`, e);

      // Dead ends are added both to the graph and to the attempt system.
      // The graph may still have old paths queued from before they were
      // marked as dead ends, so we catch that here.
      const deadEndPath = path.slice(0, i + 2);
      deadEndAttempts.push(deadEndPath);
      window.traversionGraph.addDeadEndPath(path.slice(0, i + 2));

      ui.popupBox.innerHTML = `<h2>Finding conversion route...</h2>
        <p>Looking for a valid path...</p>`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      return null;

    }
  }

  return { files, path };

}

window.tryConvertByTraversing = async function (
  files: FileData[],
  from: ConvertPathNode,
  to: ConvertPathNode
) {
  deadEndAttempts = [];
  window.traversionGraph.clearDeadEndPaths();
  for await (const path of window.traversionGraph.searchPath(from, to, simpleMode)) {
    // Use exact output format if the target handler supports it
    if (path.at(-1)?.handler === to.handler) {
      path[path.length - 1] = to;
    }
    const attempt = await attemptConvertPath(files, path);
    if (attempt) return attempt;
  }
  return null;
}

function downloadFile (bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
}

ui.convertButton.onclick = async function () {

  const inputFiles = selectedFiles;

  if (inputFiles.length === 0) {
    return alert("Select an input file.");
  }

  const inputButton = document.querySelector("#from-list .selected");
  if (!inputButton) return alert("Specify input file format.");

  const outputButton = document.querySelector("#to-list .selected");
  if (!outputButton) return alert("Specify output file format.");

  const inputOption = allOptions[Number(inputButton.getAttribute("format-index"))];
  const outputOption = allOptions[Number(outputButton.getAttribute("format-index"))];

  const inputFormat = inputOption.format;
  const outputFormat = outputOption.format;

  try {

    const inputFileData = [];
    for (const inputFile of inputFiles) {
      const inputBuffer = await inputFile.arrayBuffer();
      const inputBytes = new Uint8Array(inputBuffer);
      if (
        inputFormat.mime === outputFormat.mime
        && inputFormat.format === outputFormat.format
      ) {
        downloadFile(inputBytes, inputFile.name);
        continue;
      }
      inputFileData.push({ name: inputFile.name, bytes: inputBytes });
    }

    window.showPopup("<h2>Finding conversion route...</h2>");
    // Delay for a bit to give the browser time to render
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const output = await window.tryConvertByTraversing(inputFileData, inputOption, outputOption);
    if (!output) {
      window.hidePopup();
      alert("Failed to find conversion route.");
      return;
    }

    for (const file of output.files) {
      downloadFile(file.bytes, file.name);
    }

    window.showPopup(
      `<h2>Converted ${inputOption.format.format} to ${outputOption.format.format}!</h2>` +
      `<p>Path used: <b>${output.path.map(c => c.format.format).join(" → ")}</b>.</p>\n` +
      `<button onclick="window.hidePopup()">OK</button>`
    );

  } catch (e) {

    window.hidePopup();
    alert("Unexpected error while routing:\n" + e);
    console.error(e);

  }

};

// Display the current git commit SHA in the UI, if available
{
  const commitElement = document.querySelector("#commit-id");
  if (commitElement) {
    commitElement.textContent = import.meta.env.VITE_COMMIT_SHA ?? "unknown";
  }
}
