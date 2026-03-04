import { describe, it, expect } from "vitest";
import ApplicationState from "../js/classes/ApplicationState.js";

describe("ApplicationState", () => {
  describe("initial state", () => {
    it("currentTheme defaults to 'light'", () => {
      const state = new ApplicationState();
      expect(state.currentTheme).toBe("light");
    });

    it("markdownText defaults to empty string", () => {
      const state = new ApplicationState();
      expect(state.markdownText).toBe("");
    });
  });

  describe("setTheme()", () => {
    it("changes currentTheme to 'dark'", () => {
      const state = new ApplicationState();
      state.setTheme("dark");
      expect(state.currentTheme).toBe("dark");
    });

    it("changes currentTheme back to 'light'", () => {
      const state = new ApplicationState();
      state.setTheme("dark");
      state.setTheme("light");
      expect(state.currentTheme).toBe("light");
    });

    it("accepts arbitrary string values", () => {
      const state = new ApplicationState();
      state.setTheme("high-contrast");
      expect(state.currentTheme).toBe("high-contrast");
    });
  });

  describe("setMarkdownText()", () => {
    it("stores the given markdown text", () => {
      const state = new ApplicationState();
      state.setMarkdownText("# Hello World");
      expect(state.markdownText).toBe("# Hello World");
    });

    it("overwrites previous text", () => {
      const state = new ApplicationState();
      state.setMarkdownText("first");
      state.setMarkdownText("second");
      expect(state.markdownText).toBe("second");
    });

    it("handles empty string", () => {
      const state = new ApplicationState();
      state.setMarkdownText("something");
      state.setMarkdownText("");
      expect(state.markdownText).toBe("");
    });

    it("handles multiline markdown", () => {
      const state = new ApplicationState();
      const md = "# Title\n\nParagraph\n\n- item 1\n- item 2";
      state.setMarkdownText(md);
      expect(state.markdownText).toBe(md);
    });
  });
});
