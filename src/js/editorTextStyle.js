// INV-83: what a block editor takes from its rendered block, and what the
// marks layer behind it (INV-70) copies from the editor, so that both lay
// out their text alike. One list for both: a property added here reaches
// the layer too.

// the text itself
export const EDITOR_TEXT_PROPS = Object.freeze(["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing"]);
// the room around it (a code block's box)
export const EDITOR_PADDING_PROPS = Object.freeze(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]);
