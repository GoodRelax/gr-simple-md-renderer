// Fakes for the File System Access API (test code only).
// Every call is recorded in a shared `calls` array so tests can check the order.

/** A promise whose settlement the test controls. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function domError(name, message = name) {
  return new DOMException(message, name);
}

/**
 * Fake FileSystemFileHandle.
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {BlobPart[]} [opts.content]
 * @param {number} [opts.lastModified]
 * @param {"granted"|"denied"|Error|Promise} [opts.permission]
 * @param {Error} [opts.getFileError]
 * @param {Error} [opts.writeError]
 * @param {string[]} [opts.calls]
 */
export function fakeFileHandle(opts = {}) {
  const calls = opts.calls ?? [];
  const state = {
    content: opts.content ?? ["# Doc\n"],
    lastModified: opts.lastModified ?? 1000,
    written: [],
  };
  const handle = {
    kind: "file",
    name: opts.name ?? "doc.md",
    calls,
    state,
    requestPermission(desc) {
      calls.push(`requestPermission:${desc?.mode}`);
      const p = opts.permission ?? "granted";
      if (p instanceof Error) return Promise.reject(p);
      return Promise.resolve(p);
    },
    async getFile() {
      calls.push("getFile");
      if (opts.getFileError) throw opts.getFileError;
      return new File(state.content, handle.name, { lastModified: state.lastModified });
    },
    async createWritable() {
      calls.push("createWritable");
      let pending = null;
      return {
        async write(data) {
          calls.push("write");
          if (opts.writeError) throw opts.writeError;
          pending = data;
        },
        async close() {
          calls.push("close");
          state.written.push(pending);
          state.content = [pending];
          state.lastModified += 1000;
        },
        async abort() {
          calls.push("abort");
        },
      };
    },
  };
  return handle;
}

/**
 * Fake MarkdownFileAccess for the save use cases. Each method records its
 * call; behaviour is set per test.
 */
export function fakeFileAccess(opts = {}) {
  const calls = opts.calls ?? [];
  return {
    calls,
    downloads: [],
    writes: [],
    noted: [],
    noteFile(handle) {
      this.noted.push(handle);
    },
    canWriteInPlace() {
      return opts.canWrite ?? true;
    },
    startPermissionRequest(handle) {
      calls.push("startPermissionRequest");
      return opts.permission ?? Promise.resolve("granted");
    },
    pickerTypes: [], // the types argument of each startSavePicker (undefined: the Markdown default)
    downloadTypes: [], // the mimeType argument of each startDownload
    startSavePicker(name, types) {
      calls.push(`startSavePicker:${name}`);
      this.pickerTypes.push(types);
      return opts.picker ?? Promise.resolve(fakeFileHandle({ name: "picked.md", calls }));
    },
    async readLastModified(handle) {
      calls.push("readLastModified");
      if (opts.readLastModifiedError) throw opts.readLastModifiedError;
      return opts.lastModified ?? 1000;
    },
    async writeFile(handle, text) {
      calls.push(`writeFile:${handle.name}`);
      if (opts.writeError) throw opts.writeError;
      this.writes.push({ handle, text });
      return opts.writtenLastModified ?? 2000;
    },
    async readFile(handle, check = () => {}) {
      calls.push("readFile");
      const file = await handle.getFile();
      check(file); // as MarkdownFileAccess.readFile: before the text is read (INV-18 on Reload)
      return {
        bytesHead: new Uint8Array(await file.slice(0, 3).arrayBuffer()),
        text: await file.text(),
        lastModified: file.lastModified,
      };
    },
    startDownload(name, text, mimeType) {
      calls.push(`startDownload:${name}`);
      this.downloads.push({ name, text });
      this.downloadTypes.push(mimeType);
    },
  };
}
