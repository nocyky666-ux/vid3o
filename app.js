import { FFmpeg } from "https://esm.sh/@ffmpeg/ffmpeg@0.12.10";
import { fetchFile, toBlobURL } from "https://esm.sh/@ffmpeg/util@0.12.1";

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

// Extensions accepted as "video" even when the browser reports no/blank
// MIME type (common for .mkv, .ts, .mts picked from a plain file browser).
const VIDEO_EXTENSIONS = [
  ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm",
  ".wmv", ".flv", ".3gp", ".ts", ".mts", ".m2ts",
];

const els = {
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  fileList: document.getElementById("fileList"),
  compressBtn: document.getElementById("compressBtn"),
  clearBtn: document.getElementById("clearBtn"),
  resolution: document.getElementById("resolution"),
  fps: document.getElementById("fps"),
  bitrate: document.getElementById("bitrate"),
  status: document.getElementById("status"),
  specRes: document.getElementById("specRes"),
  specFps: document.getElementById("specFps"),
  specBitrate: document.getElementById("specBitrate"),
};

/** @type {{id:string, file:File, name:string, outName:string, status:string, progress:number, url:string|null, error:string|null, specLabel:string}[]} */
const queue = [];

let ffmpeg = null;
let ffmpegReadyPromise = null;
let currentItem = null; // item currently receiving progress events

init();

function init() {
  bindEvents();
  updateSpecReadout();
  // Start loading the engine in the background right away so it's
  // usually ready by the time the user has picked their files.
  ensureFFmpeg().catch(() => {
    /* error already surfaced via status line */
  });
}

/** Reads the current dropdown values into a plain settings object. */
function currentSettings() {
  return {
    resolution: els.resolution.value, // "original" or a target height in px
    fps: els.fps.value, // "original" or a target fps
    bitrateKbps: Number(els.bitrate.value), // target video bitrate in kbps
  };
}

/** Human-readable "compress to ..." label, used in the header and per file row. */
function specLabel(settings) {
  const res = settings.resolution === "original" ? "Reso asli" : `${settings.resolution}p`;
  const fps = settings.fps === "original" ? "fps asli" : `${settings.fps}fps`;
  const mbps = settings.bitrateKbps / 1000;
  const bitrate = `${mbps % 1 === 0 ? mbps : mbps.toFixed(1)} Mbps`;
  return `${res} · ${fps} · ${bitrate}`;
}

/** Keeps the header readout in sync with the current control values. */
function updateSpecReadout() {
  const s = currentSettings();
  els.specRes.textContent = s.resolution === "original" ? "Asli" : s.resolution;
  els.specFps.textContent = s.fps === "original" ? "Asli" : s.fps;
  const mbps = s.bitrateKbps / 1000;
  els.specBitrate.textContent = mbps % 1 === 0 ? String(mbps) : mbps.toFixed(1);
}

function bindEvents() {
  els.fileInput.addEventListener("change", (e) => addFiles(e.target.files));

  [els.resolution, els.fps, els.bitrate].forEach((el) =>
    el.addEventListener("change", updateSpecReadout)
  );

  els.dropzone.addEventListener("click", () => els.fileInput.click());
  els.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("dragover");
    })
  );
  els.dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  els.clearBtn.addEventListener("click", () => {
    queue.forEach((item) => item.url && URL.revokeObjectURL(item.url));
    queue.length = 0;
    render();
  });

  els.compressBtn.addEventListener("click", runQueue);
}

async function ensureFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (ffmpegReadyPromise) return ffmpegReadyPromise;

  ffmpegReadyPromise = (async () => {
    setStatus("Memuat mesin kompresi (hanya sekali, sekitar 25 MB)…");
    const instance = new FFmpeg();

    instance.on("progress", ({ progress }) => {
      if (!currentItem) return;
      const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : currentItem.progress;
      currentItem.progress = clamped;
      render();
    });

    try {
      const coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript");
      const wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm");
      await instance.load({ coreURL, wasmURL });
    } catch (err) {
      setStatus("Gagal memuat mesin kompresi. Periksa koneksi internet Anda, lalu muat ulang halaman.");
      ffmpegReadyPromise = null;
      throw err;
    }

    ffmpeg = instance;
    setStatus(queue.length ? "Siap. Klik \u201cKompres semua\u201d." : "Siap. Pilih video untuk mulai.");
    return instance;
  })();

  return ffmpegReadyPromise;
}

function looksLikeVideo(file) {
  if (file.type.startsWith("video/")) return true;
  // Files chosen via a plain file browser (rather than a media picker) can
  // arrive with an empty/generic MIME type, especially for .mkv/.ts/.mts.
  // Fall back to checking the extension so those aren't wrongly rejected.
  const ext = extOf(file.name).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

function addFiles(fileListLike) {
  const all = Array.from(fileListLike);
  const incoming = all.filter(looksLikeVideo);
  const rejected = all.length - incoming.length;
  if (rejected > 0) {
    setStatus(
      incoming.length > 0
        ? `${rejected} file dilewati karena bukan video.`
        : "File yang dipilih tampaknya bukan video. Coba pilih file video lain."
    );
  }
  incoming.forEach((file) => {
    queue.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())),
      file,
      name: file.name,
      outName: baseName(file.name) + ".mp4",
      status: "waiting",
      progress: 0,
      url: null,
      error: null,
      specLabel: specLabel(currentSettings()),
    });
  });
  els.fileInput.value = "";
  render();
}

function baseName(name) {
  return name.replace(/\.[^./\\]+$/, "");
}

function extOf(name) {
  const m = name.match(/\.[^./\\]+$/);
  return m ? m[0] : ".mp4";
}

async function runQueue() {
  if (queue.length === 0) return;
  els.compressBtn.disabled = true;
  els.clearBtn.disabled = true;
  els.fileInput.disabled = true;
  els.resolution.disabled = true;
  els.fps.disabled = true;
  els.bitrate.disabled = true;

  // Lock in the target settings for this whole batch so mid-run dropdown
  // changes can't apply inconsistently across files already in progress.
  const settings = currentSettings();
  const label = specLabel(settings);
  const outSuffix = buildOutSuffix(settings);
  queue.forEach((item) => {
    if (item.status === "done") return;
    item.specLabel = label;
    item.outName = baseName(item.name) + outSuffix;
  });
  render();

  try {
    const engine = await ensureFFmpeg();
    for (const item of queue) {
      if (item.status === "done") continue;
      await compressOne(engine, item, settings);
    }
    const failed = queue.filter((i) => i.status === "error").length;
    setStatus(
      failed > 0
        ? `Selesai dengan ${failed} video gagal. Lihat detail di daftar.`
        : "Semua video selesai dikompres."
    );
  } catch (err) {
    setStatus("Terjadi kesalahan saat memuat mesin kompresi. Muat ulang halaman lalu coba lagi.");
  } finally {
    els.compressBtn.disabled = false;
    els.clearBtn.disabled = false;
    els.fileInput.disabled = false;
    els.resolution.disabled = false;
    els.fps.disabled = false;
    els.bitrate.disabled = false;
  }
}

/** Filename suffix describing the target spec, e.g. "_1080p_45fps_6Mbps.mp4". */
function buildOutSuffix(settings) {
  const res = settings.resolution === "original" ? "orig" : `${settings.resolution}p`;
  const fps = settings.fps === "original" ? "origfps" : `${settings.fps}fps`;
  const mbps = settings.bitrateKbps / 1000;
  const bitrate = `${mbps % 1 === 0 ? mbps : mbps.toFixed(1)}Mbps`;
  return `_${res}_${fps}_${bitrate}.mp4`;
}

async function compressOne(engine, item, settings) {
  currentItem = item;
  item.status = "processing";
  item.progress = 0;
  item.error = null;
  render();

  const inName = `in_${item.id}${extOf(item.file.name)}`;
  const outName = `out_${item.id}.mp4`;

  const args = ["-i", inName];

  // Resolution: scale so the target height is the LONG-term cap, never
  // upscaling a source that's already smaller than the target.
  if (settings.resolution !== "original") {
    args.push("-vf", `scale=-2:'min(ih,${settings.resolution})'`);
  }

  // Frame rate: only re-time the video if a specific fps was requested.
  if (settings.fps !== "original") {
    args.push("-r", settings.fps);
  }

  // Bitrate: single-pass target bitrate with a VBV cap so the encoder
  // stays close to the requested number instead of drifting with content
  // complexity the way CRF/quality-based encoding would.
  const targetK = `${settings.bitrateKbps}k`;
  const maxK = `${Math.round(settings.bitrateKbps * 1.5)}k`;
  const bufK = `${Math.round(settings.bitrateKbps * 2)}k`;

  args.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", targetK,
    "-maxrate", maxK,
    "-bufsize", bufK,
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outName
  );

  try {
    await engine.writeFile(inName, await fetchFile(item.file));

    await engine.exec(args);

    const data = await engine.readFile(outName);
    const blob = new Blob([data.buffer], { type: "video/mp4" });
    item.url = URL.createObjectURL(blob);
    item.status = "done";
    item.progress = 1;
  } catch (err) {
    item.status = "error";
    item.error = "Gagal memproses video ini";
  } finally {
    currentItem = null;
    for (const name of [inName, outName]) {
      try {
        await engine.deleteFile(name);
      } catch {
        /* file may not exist if a step failed early; safe to ignore */
      }
    }
    render();
  }
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let val = bytes;
  let u = -1;
  do {
    val /= 1024;
    u += 1;
  } while (val >= 1024 && u < units.length - 1);
  return `${val.toFixed(1)} ${units[u]}`;
}

function labelFor(item) {
  switch (item.status) {
    case "waiting":
      return "Menunggu";
    case "processing":
      return `Memproses ${Math.round(item.progress * 100)}%`;
    case "done":
      return "Selesai";
    case "error":
      return item.error || "Error";
    default:
      return "";
  }
}

function setStatus(text) {
  els.status.textContent = text;
}

function render() {
  els.fileList.innerHTML = "";

  queue.forEach((item) => {
    const row = document.createElement("div");
    row.className = "file-row";

    const info = document.createElement("div");
    info.className = "file-info";
    info.innerHTML = `
      <span class="file-name">${escapeHtml(item.name)}</span>
      <span class="file-size">${fmtSize(item.file.size)} &middot; <span class="file-spec">${escapeHtml(item.specLabel)}</span></span>
    `;

    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = `${Math.round(item.progress * 100)}%`;
    track.appendChild(fill);

    const status = document.createElement("div");
    status.className = `file-status status-${item.status}`;
    status.textContent = labelFor(item);

    row.appendChild(info);
    row.appendChild(track);
    row.appendChild(status);

    if (item.status === "done" && item.url) {
      const a = document.createElement("a");
      a.className = "download-btn";
      a.href = item.url;
      a.download = item.outName;
      a.textContent = "Unduh";
      row.appendChild(a);
    }

    els.fileList.appendChild(row);
  });

  els.compressBtn.disabled = queue.length === 0 || queue.every((i) => i.status === "done");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
