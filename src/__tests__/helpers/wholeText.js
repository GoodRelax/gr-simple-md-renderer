import { vi } from "vitest";

// Count-based checks of "no work on the whole text" (review standard G10 by
// counting, not by the clock; G12): the string work done on long strings
// while watching, and the writes of a whole textarea value. jsdom's own
// work inside the textarea (its value and setRangeText are JavaScript here,
// native code in a browser) is not counted.

const SCANS = ["indexOf", "lastIndexOf"];
const PER_CHAR = ["charCodeAt", "codePointAt", "charAt", "at"];
const COPIES = ["slice", "substring", "substr"];
const WHOLE = ["split", "replace", "replaceAll", "match", "matchAll", "search", "includes", "localeCompare", "trim", "toLowerCase", "toUpperCase", "normalize"];

/**
 * Watch the string work on strings longer than minLength. A copy (slice)
 * longer than minLength, an indexOf / lastIndexOf that scans more than
 * minLength chars, more than minLength char reads in all, any whole-string
 * method, and any assignment of a textarea's value are listed in calls.
 * @param {number} [minLength]
 * @returns {{start: () => void, stop: () => void, calls: string[], valueWrites: number}}
 */
export function watchWholeTextWork(minLength = 1000) {
  const calls = [];
  const charReads = new Map();
  let watching = false;
  let inside = 0; // inside jsdom's textarea code
  const counts = () => watching && inside === 0;
  for (const name of SCANS) {
    const original = String.prototype[name];
    vi.spyOn(String.prototype, name).mockImplementation(function (search, position) {
      const at = original.call(this, search, position);
      if (counts() && this.length > minLength) {
        const from = position === undefined ? (name === "indexOf" ? 0 : this.length) : Number(position);
        const reached = at < 0 ? (name === "indexOf" ? this.length : 0) : at;
        if (Math.abs(reached - from) > minLength) calls.push(`${name} over ${Math.abs(reached - from)} chars`);
      }
      return at;
    });
  }
  for (const name of PER_CHAR) {
    const original = String.prototype[name];
    vi.spyOn(String.prototype, name).mockImplementation(function (...args) {
      if (counts() && this.length > minLength) charReads.set(name, (charReads.get(name) ?? 0) + 1);
      return original.apply(this, args);
    });
  }
  for (const name of COPIES) {
    const original = String.prototype[name];
    vi.spyOn(String.prototype, name).mockImplementation(function (...args) {
      const copy = original.apply(this, args);
      if (counts() && copy.length > minLength) calls.push(`${name} of ${copy.length} chars`);
      return copy;
    });
  }
  for (const name of WHOLE) {
    const original = String.prototype[name];
    vi.spyOn(String.prototype, name).mockImplementation(function (...args) {
      if (counts() && this.length > minLength) calls.push(name);
      return original.apply(this, args);
    });
  }
  const proto = HTMLTextAreaElement.prototype;
  const value = Object.getOwnPropertyDescriptor(proto, "value");
  const state = { valueWrites: 0 };
  vi.spyOn(proto, "value", "get").mockImplementation(function () {
    inside++;
    try {
      return value.get.call(this);
    } finally {
      inside--;
    }
  });
  vi.spyOn(proto, "value", "set").mockImplementation(function (v) {
    if (watching) state.valueWrites++;
    inside++;
    try {
      value.set.call(this, v);
    } finally {
      inside--;
    }
  });
  for (const name of ["setRangeText", "setSelectionRange"]) {
    const original = proto[name];
    vi.spyOn(proto, name).mockImplementation(function (...args) {
      inside++;
      try {
        return original.apply(this, args);
      } finally {
        inside--;
      }
    });
  }
  for (const name of ["selectionStart", "selectionEnd"]) {
    const original = Object.getOwnPropertyDescriptor(proto, name);
    vi.spyOn(proto, name, "get").mockImplementation(function () {
      inside++;
      try {
        return original.get.call(this);
      } finally {
        inside--;
      }
    });
  }
  return {
    calls,
    get valueWrites() {
      return state.valueWrites;
    },
    start() {
      watching = true;
    },
    stop() {
      watching = false;
      for (const [name, n] of charReads) if (n > minLength) calls.push(`${name} x${n}`);
      charReads.clear();
    },
  };
}
