import { describe, it, expect } from "vitest";
import { CONFIG, EXT_TO_HLJS, BINARY_EXTENSIONS, FILE_SYSTEM_HANDLE_SUPPORTED } from "../js/config.js";

describe("CONFIG", () => {
  it("CONFIG.fileDrop.messages.unsupportedType exists and is a non-empty string", () => {
    expect(CONFIG.fileDrop.messages.unsupportedType).toBeDefined();
    expect(typeof CONFIG.fileDrop.messages.unsupportedType).toBe("string");
    expect(CONFIG.fileDrop.messages.unsupportedType.length).toBeGreaterThan(0);
  });

  it("CONFIG.fileDrop.messages.tooLarge exists", () => {
    expect(typeof CONFIG.fileDrop.messages.tooLarge).toBe("string");
    expect(CONFIG.fileDrop.messages.tooLarge.length).toBeGreaterThan(0);
  });

  it("CONFIG.fileDrop.messages.readError exists", () => {
    expect(typeof CONFIG.fileDrop.messages.readError).toBe("string");
    expect(CONFIG.fileDrop.messages.readError.length).toBeGreaterThan(0);
  });

  it("CONFIG.fileDrop.messages.binaryFile exists", () => {
    expect(typeof CONFIG.fileDrop.messages.binaryFile).toBe("string");
    expect(CONFIG.fileDrop.messages.binaryFile.length).toBeGreaterThan(0);
  });

  it("CONFIG.fileDrop.maxBytes is 5 MB", () => {
    expect(CONFIG.fileDrop.maxBytes).toBe(5 * 1024 * 1024);
  });
});

describe("EXT_TO_HLJS", () => {
  it("contains .py mapping to python", () => {
    expect(EXT_TO_HLJS[".py"]).toBe("python");
  });

  it("contains .js mapping to javascript", () => {
    expect(EXT_TO_HLJS[".js"]).toBe("javascript");
  });

  it("contains .md mapping to markdown", () => {
    expect(EXT_TO_HLJS[".md"]).toBe("markdown");
  });

  it("contains Dockerfile mapping to dockerfile", () => {
    expect(EXT_TO_HLJS["Dockerfile"]).toBe("dockerfile");
  });

  it("contains Makefile mapping to makefile", () => {
    expect(EXT_TO_HLJS["Makefile"]).toBe("makefile");
  });

  it("contains .txt mapping to plaintext", () => {
    expect(EXT_TO_HLJS[".txt"]).toBe("plaintext");
  });

  it("does not contain unknown extensions", () => {
    expect(EXT_TO_HLJS[".xyz"]).toBeUndefined();
    expect(EXT_TO_HLJS[".banana"]).toBeUndefined();
  });
});

describe("BINARY_EXTENSIONS", () => {
  it("is a Set", () => {
    expect(BINARY_EXTENSIONS).toBeInstanceOf(Set);
  });

  it("contains common binary extensions", () => {
    expect(BINARY_EXTENSIONS.has(".png")).toBe(true);
    expect(BINARY_EXTENSIONS.has(".exe")).toBe(true);
    expect(BINARY_EXTENSIONS.has(".pdf")).toBe(true);
    expect(BINARY_EXTENSIONS.has(".zip")).toBe(true);
  });

  it("does not contain text extensions", () => {
    expect(BINARY_EXTENSIONS.has(".py")).toBe(false);
    expect(BINARY_EXTENSIONS.has(".js")).toBe(false);
    expect(BINARY_EXTENSIONS.has(".md")).toBe(false);
    expect(BINARY_EXTENSIONS.has(".txt")).toBe(false);
  });
});

describe("FILE_SYSTEM_HANDLE_SUPPORTED", () => {
  it("is a boolean", () => {
    expect(typeof FILE_SYSTEM_HANDLE_SUPPORTED).toBe("boolean");
  });
});
