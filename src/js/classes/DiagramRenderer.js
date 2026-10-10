export default class DiagramRenderer {
  /** @purity pure */
  async render(theme, skipRendering) {
    throw new Error("DiagramRenderer.render() must be implemented");
  }
}
