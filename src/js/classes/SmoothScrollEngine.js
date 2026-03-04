/**
 * Velocity-friction model keyboard scroll animation.
 * Call startScroll(dir) on keydown ArrowUp/Down,
 * stopScroll() on keyup, destroy() on page leave or clear.
 */
export default class SmoothScrollEngine {
  /**
   * @param {object} config - CONFIG.scroll reference
   * @param {HTMLElement} [scrollTarget] - element to scroll (defaults to window)
   */
  constructor(config, scrollTarget) {
    this._cfg = config;
    this._scrollTarget = scrollTarget || null;
    this._velocity = 0;
    this._direction = 0; // +1: down, -1: up
    this._keyHeld = false;
    this._rafId = null;
    this._lastTs = null;
    this._loop = this._loop.bind(this);
  }

  /** Call on keydown ArrowUp (-1) or ArrowDown (+1) */
  startScroll(direction) {
    this._direction = direction;
    this._keyHeld = true;
    if (!this._rafId) {
      this._lastTs = null;
      this._rafId = requestAnimationFrame(this._loop);
      this._setScrolling(true);
    }
  }

  /** Call on keyup ArrowUp or ArrowDown; inertia decays naturally */
  stopScroll() {
    this._keyHeld = false;
  }

  /** Cancel animation and reset state. Call on page leave or Clear. */
  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._velocity = 0;
    this._lastTs = null;
    this._setScrolling(false);
  }

  /** Add/remove .scrolling class on scrollTarget to suppress hover flicker */
  _setScrolling(active) {
    if (!this._scrollTarget) return;
    this._scrollTarget.classList.toggle("scrolling", active);
  }

  _loop(ts) {
    if (this._lastTs !== null) {
      const dt = Math.min(ts - this._lastTs, 50); // cap at 50ms (FR-09)

      if (this._keyHeld) {
        this._velocity = Math.min(
          this._velocity + this._cfg.acceleration * dt,
          this._cfg.maxSpeed,
        );
      } else {
        // Normalise friction to 60fps so behaviour is frame-rate independent
        this._velocity *= Math.pow(this._cfg.friction, dt / 16.67);
      }

      if (this._velocity > 0.005) {
        const target = this._scrollTarget || window;
        target.scrollBy(0, this._direction * this._velocity * dt);
      } else {
        this._velocity = 0;
        this._rafId = null;
        this._lastTs = null;
        this._setScrolling(false);
        return;
      }
    }

    this._lastTs = ts;
    this._rafId = requestAnimationFrame(this._loop);
  }
}
