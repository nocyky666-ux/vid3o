import { FFmpeg } from "https://esm.sh/@ffmpeg/ffmpeg@0.12.10";
import { fetchFile, toBlobURL } from "https://esm.sh/@ffmpeg/util@0.12.1";

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

const CRF_BY_QUALITY = { high: 23, balanced: 28, small: 32 };

const els = {
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  fileList: document.getElementById("fileList"),
  compressBtn: document.getElementById("compressBtn"),
  clearBtn: document.getElementById("clearBtn"),
  quality: document.getElementById("quality"),
  status: document.getElementById("status"),
};

/** @type {{id:string, file:File, name:string, outName:string, status:string, progress:number, url:string|null, error:string|null}[]} */
const queue = [];

let ffmpeg = null;
let ffmpegReadyPromise = null;
let currentItem = null; // item currently receiving progress events

init();

function init() {
  bindEvents();
  // Start loading the engine in the background right away so it's
  // usually ready by the time the user has picked their files.
  ensureFFmpeg().catch(() => {
    /* error already surfaced via status line */
  });
}

function bindEvents() {
  els.fileInput.addEventListener("change", (e) => addFiles(e.target.files));

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

function addFiles(fileListLike) {
  const incoming = Array.from(fileListLike).filter((f) => f.type.startsWith("video/"));
  if (incoming.length === 0 && fileListLike.length > 0) {
    setStatus("File yang dipilih tampaknya bukan video. Coba pilih file video lain.");
  }
  incoming.forEach((file) => {
    queue.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())),
      file,
      name: file.name,
      outName: baseName(file.name) + "_1080p45fps.mp4",
      status: "waiting",
      progress: 0,
      url: null,
      error: null,
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

  try {
    const engine = await ensureFFmpeg();
    for (const item of queue) {
      if (item.status === "done") continue;
      await compressOne(engine, item);
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
  }
}

async function compressOne(engine, item) {
  currentItem = item;
  item.status = "processing";
  item.progress = 0;
  item.error = null;
  render();

  const inName = `in_${item.id}${extOf(item.file.name)}`;
  const outName = `out_${item.id}.mp4`;
  const crf = CRF_BY_QUALITY[els.quality.value] ?? 28;

  try {
    await engine.writeFile(inName, await fetchFile(item.file));

    await engine.exec([
      "-i", inName,
      "-vf", "scale=-2:1080",
      "-r", "45",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", String(crf),
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outName,
    ]);

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
      <span class="file-size">${fmtSize(item.file.size)}</span>
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
