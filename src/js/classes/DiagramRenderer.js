export default class DiagramRenderer {
  /** @purity pure */
  async render(theme, root) {
    throw new Error("DiagramRenderer.render() must be implemented");
  }
}
