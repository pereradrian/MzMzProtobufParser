(function () {
"use strict";

const { parseMessage, detectAndDecode } = window.ProtobufParser;

const inputEl       = document.getElementById("input-data");
const btnParse      = document.getElementById("btn-parse");
const btnClear      = document.getElementById("btn-clear");
const btnCopy       = document.getElementById("btn-copy");
const outputSection = document.getElementById("output-section");
const treeContainer = document.getElementById("tree-container");
const errorSection  = document.getElementById("error-section");
const errorMsg      = document.getElementById("error-msg");
const formatBadge   = document.getElementById("format-badge");

let lastParsed = null;

// ── Parse ──────────────────────────────────────────────────────
function doParse() {
  const raw = inputEl.value.trim();
  if (!raw) return;

  hideError();
  outputSection.classList.add("hidden");
  treeContainer.innerHTML = "";
  lastParsed = null;

  try {
    const { bytes, format } = detectAndDecode(raw);
    const fields = parseMessage(bytes);

    formatBadge.textContent = format.toUpperCase();
    formatBadge.classList.remove("hidden");

    lastParsed = fields;
    renderTree(fields, treeContainer);
    outputSection.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  }
}

// ── Render tree ────────────────────────────────────────────────
function renderTree(fields, container) {
  for (const field of fields) {
    container.appendChild(buildFieldNode(field));
  }
}

function buildFieldNode(field) {
  const wrapper = document.createElement("div");
  wrapper.className = "field-node";

  const header = document.createElement("div");
  header.className = "field-header";

  const hasChildren = field.fields && field.fields.length > 0;

  // Toggle icon
  const toggleIcon = document.createElement("span");
  toggleIcon.className = "toggle-icon";
  toggleIcon.textContent = hasChildren ? "▶" : " ";

  // Field number
  const numEl = document.createElement("span");
  numEl.className = "field-num";
  numEl.textContent = `#${field.fieldNumber}`;

  // Wire type
  const typeEl = document.createElement("span");
  typeEl.className = "field-type";
  typeEl.textContent = field.wireTypeName;

  header.appendChild(toggleIcon);
  header.appendChild(numEl);
  header.appendChild(typeEl);

  if (hasChildren) {
    // Nested message
    const interpEl = document.createElement("span");
    interpEl.className = "field-interp";
    interpEl.textContent = `message (${field.fields.length} field${field.fields.length !== 1 ? "s" : ""})`;
    header.appendChild(interpEl);

    const childrenEl = document.createElement("div");
    childrenEl.className = "field-children";
    renderTree(field.fields, childrenEl);

    let expanded = false;
    header.addEventListener("click", () => {
      expanded = !expanded;
      toggleIcon.textContent = expanded ? "▼" : "▶";
      childrenEl.style.display = expanded ? "block" : "none";
    });
    childrenEl.style.display = "none";

    wrapper.appendChild(header);
    wrapper.appendChild(childrenEl);
  } else {
    // Leaf value
    if (field.interpretation) {
      const interpEl = document.createElement("span");
      interpEl.className = "field-interp";
      interpEl.textContent = field.interpretation;
      header.appendChild(interpEl);
    }

    const valueEl = document.createElement("span");
    valueEl.className = "field-value";

    if (field.type === "varint") {
      valueEl.classList.add("number");
      const parts = [`${field.value}`];
      if (field.valueHex) parts.push(field.valueHex);
      if (field.valueSigned !== field.value) parts.push(`signed: ${field.valueSigned}`);
      valueEl.textContent = parts.join("  ");
    } else if (field.type === "64-bit") {
      valueEl.classList.add("number");
      valueEl.textContent = `double: ${field.valueDouble}  fixed64: ${field.valueFixed64}  hex: ${field.valueHex}`;
    } else if (field.type === "32-bit") {
      valueEl.classList.add("number");
      valueEl.textContent = `float: ${field.valueFloat}  fixed32: ${field.valueFixed32}  hex: ${field.valueHex}`;
    } else if (field.interpretation === "string") {
      valueEl.classList.add("string");
      valueEl.textContent = `"${field.value}"`;
    } else if (field.interpretation === "bytes") {
      valueEl.classList.add("bytes");
      valueEl.textContent = `[${field.byteLength} bytes] ${field.value}`;
    } else {
      valueEl.textContent = field.value ?? "";
    }

    header.appendChild(valueEl);
    wrapper.appendChild(header);
  }

  return wrapper;
}

// ── Copy JSON ──────────────────────────────────────────────────
btnCopy.addEventListener("click", () => {
  if (!lastParsed) return;
  const json = JSON.stringify(lastParsed, (_, v) =>
    typeof v === "bigint" ? v.toString() : v, 2);
  navigator.clipboard.writeText(json).then(() => {
    btnCopy.textContent = "Copied!";
    setTimeout(() => { btnCopy.textContent = "Copy JSON"; }, 1500);
  });
});

// ── Clear ──────────────────────────────────────────────────────
btnClear.addEventListener("click", () => {
  inputEl.value = "";
  outputSection.classList.add("hidden");
  errorSection.classList.add("hidden");
  formatBadge.classList.add("hidden");
  treeContainer.innerHTML = "";
  lastParsed = null;
});

// ── Error helpers ──────────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = `Error: ${msg}`;
  errorSection.classList.remove("hidden");
}

function hideError() {
  errorSection.classList.add("hidden");
  errorMsg.textContent = "";
}

// ── Keyboard shortcut: Enter to parse ─────────────────────────
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doParse();
  }
});

btnParse.addEventListener("click", doParse);

})();
