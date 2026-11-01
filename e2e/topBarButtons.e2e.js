import { test, expect, dropFile, renderMarkdown, settled } from "./fixtures.js";

// The top bar's buttons (owner rulings BI-14 to BI-17, R6): every button but
// [?] is a rounded rectangle (6px corners, a 1px frame) with the colors of
// the theme, the same in every browser; [Edit] is green while editing
// (BI-1, BI-2, R1): in the Markdown edit mode and the code edit mode, the
// palette minimized too.

const LIGHT = { background: "rgb(246, 248, 250)", border: "rgb(209, 217, 224)", color: "rgb(31, 35, 40)" };
const DARK = { background: "rgb(33, 40, 48)", border: "rgb(61, 68, 77)", color: "rgb(240, 246, 252)" };
const GREEN_LIGHT = { background: "rgb(31, 136, 61)", color: "rgb(255, 255, 255)" };
const GREEN_DARK = { background: "rgb(35, 134, 54)", color: "rgb(255, 255, 255)" };

/** The look of each shown button of the top bar, by id. */
function buttonLooks(page) {
  return page.evaluate(() => {
    const look = (el) => {
      const s = getComputedStyle(el);
      return {
        radius: s.borderTopLeftRadius,
        frame: `${s.borderTopWidth} ${s.borderTopStyle}`,
        appearance: s.appearance || s.webkitAppearance,
        background: s.backgroundColor,
        border: s.borderTopColor,
        color: s.color,
      };
    };
    const out = {};
    for (const el of document.querySelectorAll("#controls button")) if (!el.hidden) out[el.id] = look(el);
    out.helpBtn = look(document.getElementById("helpBtn"));
    return out;
  });
}

/** The look of [Edit], with the mouse off the top bar (no hover color). */
async function editLook(page) {
  await page.mouse.move(400, 600);
  return page.locator("#editBtn").evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, color: s.color };
  });
}

for (const theme of ["light", "dark"]) {
  test(`R6 (BI-14 to BI-16): every top-bar button but [?] is a 6px rounded rectangle with a 1px frame, in the ${theme} colors`, async ({ page }) => {
    await page.goto("/");
    await renderMarkdown(page, "# Buttons\n\nText.\n");
    if (theme === "dark") await page.locator("#renderDark").click();
    await settled(page);
    await page.mouse.move(400, 600); // off the top bar: no hover color
    const looks = await buttonLooks(page);
    const colors = theme === "dark" ? DARK : LIGHT;
    const { helpBtn, ...buttons } = looks;
    expect(Object.keys(buttons)).toEqual(expect.arrayContaining(["indexBtn", "searchBtn", "commandsBtn", "renderLight", "renderDark", "reloadBtn", "newTabBtn", "editBtn", "saveBtn", "clearBtn"]));
    for (const [id, look] of Object.entries(buttons)) {
      expect(look.radius, id).toBe("6px");
      expect(look.frame, id).toBe("1px solid");
      expect(look.appearance, id).toBe("none");
      expect(look.background, id).toBe(colors.background);
      expect(look.border, id).toBe(colors.border);
    }
    // the enabled ones have the theme's text color (a disabled one is paler)
    for (const id of ["renderLight", "renderDark", "reloadBtn", "newTabBtn", "editBtn", "saveBtn", "clearBtn"]) expect(buttons[id].color, id).toBe(colors.color);
    // [?] keeps its own look (BI-15)
    expect(helpBtn.radius).not.toBe("6px");
  });
}

test("R1 (BI-1, BI-2): [Edit] is green with white text while the Markdown edit mode is on, minimized too, and back after it", async ({ page }) => {
  await page.goto("/");
  await renderMarkdown(page, "# Edit\n\nText.\n");
  await settled(page);
  expect(await editLook(page)).toEqual({ background: LIGHT.background, color: LIGHT.color });
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
  await expect.poll(() => editLook(page)).toEqual(GREEN_LIGHT);
  const grip = await page.locator("#paletteGrip").boundingBox();
  await page.mouse.dblclick(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await expect(page.locator("#editPalette")).toHaveClass(/edit-palette-minimized/);
  expect(await editLook(page)).toEqual(GREEN_LIGHT);
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
  await expect.poll(() => editLook(page)).toEqual({ background: LIGHT.background, color: LIGHT.color });
});

test("R1 (BI-1, BI-2): [Edit] is green in the code edit mode, and in the dark colors in the dark theme", async ({ page }) => {
  await page.goto("/");
  await dropFile(page, { name: "data.json", text: '{\n  "a": 1\n}\n' });
  await expect(page.locator("body")).toHaveClass(/\bview-code\b/);
  await page.locator("#renderLight").click(); // the code view may open dark
  await expect(page.locator("body")).not.toHaveClass(/\bdark\b/);
  await page.locator("#editBtn").click();
  await expect(page.locator("#codeEditBody textarea.code-edit-input")).toBeFocused();
  await expect.poll(() => editLook(page)).toEqual(GREEN_LIGHT);
  await page.locator("#editBtn").click();
  await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
  await expect.poll(() => editLook(page)).toEqual({ background: LIGHT.background, color: LIGHT.color });
  await page.locator("#renderDark").click();
  await expect(page.locator("body")).toHaveClass(/\bdark\b/);
  await page.locator("#editBtn").click();
  await expect.poll(() => editLook(page)).toEqual(GREEN_DARK);
});

