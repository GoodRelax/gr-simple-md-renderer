import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import SmoothScrollEngine from "../js/classes/SmoothScrollEngine.js";

describe("SmoothScrollEngine", () => {
  const mockConfig = {
    maxSpeed: 0.5,
    acceleration: 0.001,
    friction: 0.5,
  };

  let rafCallback;
  let rafIdCounter;

  beforeEach(() => {
    rafIdCounter = 0;
    rafCallback = null;

    // Mock requestAnimationFrame to capture the callback
    vi.stubGlobal("requestAnimationFrame", vi.fn((cb) => {
      rafCallback = cb;
      return ++rafIdCounter;
    }));

    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    // Mock window.scrollBy for _loop usage
    vi.stubGlobal("scrollBy", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("stores config reference", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      expect(engine._cfg).toBe(mockConfig);
    });

    it("initializes velocity to 0", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      expect(engine._velocity).toBe(0);
    });

    it("initializes direction to 0", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      expect(engine._direction).toBe(0);
    });

    it("initializes _keyHeld to false", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      expect(engine._keyHeld).toBe(false);
    });

    it("initializes _rafId to null", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      expect(engine._rafId).toBeNull();
    });

    it("initializes _lastTs to null", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      expect(engine._lastTs).toBeNull();
    });
  });

  describe("startScroll(direction)", () => {
    it("sets direction to +1 for scrolling down", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(+1);
      expect(engine._direction).toBe(1);
    });

    it("sets direction to -1 for scrolling up", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(-1);
      expect(engine._direction).toBe(-1);
    });

    it("sets _keyHeld to true", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);
      expect(engine._keyHeld).toBe(true);
    });

    it("calls requestAnimationFrame to start the loop", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);
      expect(requestAnimationFrame).toHaveBeenCalledOnce();
      expect(engine._rafId).toBe(1);
    });

    it("does not call requestAnimationFrame again if already running", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);
      engine.startScroll(-1);
      // Only one RAF call; direction updated but no second RAF
      expect(requestAnimationFrame).toHaveBeenCalledOnce();
      expect(engine._direction).toBe(-1);
    });

    it("resets _lastTs to null when starting fresh", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine._lastTs = 999;
      engine._rafId = null; // ensure no active loop
      engine.startScroll(1);
      expect(engine._lastTs).toBeNull();
    });
  });

  describe("stopScroll()", () => {
    it("sets _keyHeld to false", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);
      expect(engine._keyHeld).toBe(true);
      engine.stopScroll();
      expect(engine._keyHeld).toBe(false);
    });
  });

  describe("destroy()", () => {
    it("calls cancelAnimationFrame when RAF is active", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);
      const savedId = engine._rafId;
      engine.destroy();
      expect(cancelAnimationFrame).toHaveBeenCalledWith(savedId);
    });

    it("sets _rafId to null", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);
      engine.destroy();
      expect(engine._rafId).toBeNull();
    });

    it("resets _velocity to 0", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine._velocity = 5;
      engine.destroy();
      expect(engine._velocity).toBe(0);
    });

    it("resets _lastTs to null", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine._lastTs = 100;
      engine.destroy();
      expect(engine._lastTs).toBeNull();
    });

    it("does not call cancelAnimationFrame when no RAF is active", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.destroy();
      expect(cancelAnimationFrame).not.toHaveBeenCalled();
    });
  });

  describe("scrolling class (INV-18b)", () => {
    it("adds .scrolling class to scrollTarget on startScroll", () => {
      const target = document.createElement("div");
      const engine = new SmoothScrollEngine(mockConfig, target);
      engine.startScroll(1);
      expect(target.classList.contains("scrolling")).toBe(true);
    });

    it("removes .scrolling class on destroy", () => {
      const target = document.createElement("div");
      const engine = new SmoothScrollEngine(mockConfig, target);
      engine.startScroll(1);
      engine.destroy();
      expect(target.classList.contains("scrolling")).toBe(false);
    });

    it("removes .scrolling class when velocity drops to zero", () => {
      const target = document.createElement("div");
      target.scrollBy = vi.fn();
      const engine = new SmoothScrollEngine(mockConfig, target);
      engine.startScroll(1);

      // First frame
      rafCallback(0);
      // Second frame: tiny velocity
      rafCallback(1);
      engine.stopScroll();

      // Bleed velocity to zero
      let ts = 1;
      for (let i = 0; i < 100; i++) {
        ts += 16;
        if (!rafCallback) break;
        rafCallback(ts);
      }

      expect(target.classList.contains("scrolling")).toBe(false);
    });

    it("does not throw when scrollTarget is null", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      expect(() => engine.startScroll(1)).not.toThrow();
      expect(() => engine.destroy()).not.toThrow();
    });
  });

  describe("_loop(ts)", () => {
    it("on first call stores ts and schedules next frame", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);
      requestAnimationFrame.mockClear();

      // Simulate first RAF callback
      rafCallback(100);

      expect(engine._lastTs).toBe(100);
      expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it("on second call with keyHeld, increases velocity and scrolls", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);

      // First frame: just records timestamp
      rafCallback(100);
      requestAnimationFrame.mockClear();

      // Second frame: dt = 16ms, accelerates
      rafCallback(116);

      expect(engine._velocity).toBeGreaterThan(0);
      expect(scrollBy).toHaveBeenCalled();
    });

    it("applies friction when key is released", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);

      // First frame
      rafCallback(0);
      // Second frame: build velocity
      rafCallback(16);
      const velAfterAccel = engine._velocity;

      // Release key
      engine.stopScroll();
      // Third frame: friction applied
      rafCallback(32);

      expect(engine._velocity).toBeLessThan(velAfterAccel);
    });

    it("stops loop when velocity drops below threshold", () => {
      const engine = new SmoothScrollEngine(mockConfig);
      engine.startScroll(1);

      // First frame
      rafCallback(0);
      // Second frame: tiny velocity
      rafCallback(1); // dt=1ms -> very small acceleration
      engine.stopScroll();

      requestAnimationFrame.mockClear();

      // Many frames with friction to bleed velocity
      let ts = 1;
      for (let i = 0; i < 100; i++) {
        ts += 16;
        if (!rafCallback) break;
        rafCallback(ts);
      }

      // Eventually _rafId should be null (loop stopped)
      expect(engine._rafId).toBeNull();
      expect(engine._velocity).toBe(0);
    });
  });
});
