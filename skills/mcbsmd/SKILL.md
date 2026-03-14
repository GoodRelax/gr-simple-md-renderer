---
name: mcbsmd
description: Output content in MCBSMD (Multiple Code Blocks in a Single Markdown) format. Use when the user wants structured documentation with code blocks and diagrams saved as a .md file.
argument-hint: [topic]
allowed-tools: Write, Bash
---

# MCBSMD Output Skill

You are tasked with generating content about the given topic in **MCBSMD format**, saving it as a `.md` file, and opening the folder in Explorer.

## Topic

$ARGUMENTS

## Instructions

1. Generate comprehensive content about the topic in the MCBSMD format specified below.
2. Save the output as a `.md` file in the appropriate project subfolder (e.g., `./docs`, `./specs`, `./assets`, or their subfolders — choose based on the conversation context and the nature of the content). If no specific subfolder is contextually appropriate, save in the project root.
3. The filename should be derived from the topic (e.g., `output-style-spec.md`).
4. After saving, open the folder containing the file in Windows Explorer using `start <folder-path>`.

## Output Format

- Output the entire content **as a single Markdown code block** so it can be copied in one go.
- **Enclose the entire Markdown with six backticks ```` `````` ```` at the beginning and end.** Specify its language as markdown.
- **Use these six backticks only once as the outermost enclosure.**
- **Never output speculation or fabrications.** If something is unclear or requires investigation, explicitly state so.
- This method is called **MCBSMD** (Multiple Code Blocks in a Single Markdown)

### Code and Diagram Block Rules

- As a rule, use Mermaid for diagrams. Use PlantUML only when the diagram cannot be expressed in Mermaid.
- Any diagrams or software code inside the Markdown must each be enclosed in their own code blocks using triple backticks ` ``` `.
- Each code block must specify a language or file type (e.g., ` ```python ` or ` ```mermaid `).
- Each code or diagram block must be preceded by a descriptive title in the format **title:**
  (e.g., `**System Architecture:**`, `**Login Flow:**`)
- Always follow the structure below for every code or diagram block:

  > **title:**
  >
  > ```language
  > (code or diagram content here without truncation or abbreviation)
  > ```
  >
  > Write the explanation for the code block here, immediately after the block, following a blank line.

- Do not write explanations inside the code blocks.
- In all diagrams, prefer alphanumeric characters and underscores (`_`); non-ASCII text (no spaces) is allowed only when non-English is more appropriate for the diagram.
  Special symbols (e.g., `\`, `/`, `|`, `<`, `>`, `{`, `}`) are strictly prohibited.
- Output all diagram content without omission. Never use `...` or any shorthand.

### Diagram Label and Notation Rules

- All arrows and relationship lines in diagrams MUST have labels. Follow these notation rules:
  1. Mermaid `flowchart` and `graph`: place the label inside the arrow using pipes (e.g., `A -->|Label| B`)
  2. Other Mermaid diagrams / All PlantUML: place the label after the arrow using a colon (e.g., `A --> B : Label`)
- For line breaks in labels or node text:
  1. Mermaid: use `<br/>` inside a quoted string (e.g., `A -->|"Line1<br/>Line2"| B`, `A["Line1<br/>Line2"]`)
  2. PlantUML: use `\n` (e.g., `A -> B : Line1\nLine2`)

### Math Rules

- Use standard LaTeX notation for all mathematical formulas.
  1. Inline math: always use single dollar signs. Place a space before the opening `$` and a space after the closing `$` (e.g., `The function is $y = x + 1$ here.`)
  2. Block equations: always place `$$` on its own line, above and below the formula.
     Example:

     $$
     E = mc^2
     $$
