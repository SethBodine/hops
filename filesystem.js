// ---- FileWorkspace: open a JSON file on disk, and save straight back to it ----
// Uses the browser's File System Access API (Chrome/Edge/Opera - not Firefox/Safari).
// This is entirely user-initiated (a real file picker each time you "Open"), never
// silent/background file access, matching the browser's own permission model.
// Where unsupported, the app falls back to the existing download-based Export/Import,
// which works everywhere.

const FileWorkspace = {
  supported: typeof window !== "undefined" && "showOpenFilePicker" in window && "showSaveFilePicker" in window,
  fileHandle: null, // in-memory only - re-link with "Open File" after a page reload

  get linkedName() { return this.fileHandle ? this.fileHandle.name : null; },

  async openFile() {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "Hops backup", accept: { "application/json": [".json"] } }],
      excludeAcceptAllOption: false,
      multiple: false,
    });
    const file = await handle.getFile();
    const text = await file.text();
    const data = Security.safeParseJSON(text, 20000000);
    this.fileHandle = handle;
    return data;
  },

  async saveAsNewFile(dataObj, suggestedName) {
    const handle = await window.showSaveFilePicker({
      suggestedName: suggestedName || "hops-working-file.json",
      types: [{ description: "Hops backup", accept: { "application/json": [".json"] } }],
    });
    await this._write(handle, dataObj);
    this.fileHandle = handle;
    return handle.name;
  },

  async saveToLinkedFile(dataObj) {
    if (!this.fileHandle) throw new Error("No file linked yet");
    // Permission can lapse (e.g. after reload); re-request if needed.
    if ((await this.fileHandle.queryPermission({ mode: "readwrite" })) !== "granted") {
      const perm = await this.fileHandle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted") throw new Error("Permission to write to the file was not granted");
    }
    await this._write(this.fileHandle, dataObj);
    return this.fileHandle.name;
  },

  async _write(handle, dataObj) {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(dataObj, null, 2));
    await writable.close();
  },

  unlink() { this.fileHandle = null; },
};
