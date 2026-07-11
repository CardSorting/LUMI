const fs = require("fs")
const path = require("path")

// Target Directories
const DOCS_DIR = path.join(__dirname, "..", "docs")
const BUILD_DIR = path.join(__dirname, "..", "build-blog")

// Ensure target build directory exists
if (!fs.existsSync(BUILD_DIR)) {
	fs.mkdirSync(BUILD_DIR, { recursive: true })
}

// Helper to recursively find markdown files
function getMarkdownFiles(dir) {
	let results = []
	const list = fs.readdirSync(dir)
	list.forEach((file) => {
		const filePath = path.join(dir, file)
		const stat = fs.statSync(filePath)
		if (stat && stat.isDirectory()) {
			if (file !== "node_modules" && file !== "assets") {
				results = results.concat(getMarkdownFiles(filePath))
			}
		} else if (file.endsWith(".md") || file.endsWith(".mdx")) {
			results.push(filePath)
		}
	})
	return results
}

// Simple Frontmatter & Markdown Parser
function parseMarkdown(content) {
	const metadata = {}
	let body = content

	// Extract frontmatter
	if (content.startsWith("---")) {
		const endIdx = content.indexOf("---", 3)
		if (endIdx !== -1) {
			const frontmatterText = content.substring(3, endIdx)
			body = content.substring(endIdx + 3)
			frontmatterText.split("\n").forEach((line) => {
				const parts = line.split(":")
				if (parts.length >= 2) {
					const key = parts[0].trim()
					const val = parts
						.slice(1)
						.join(":")
						.trim()
						.replace(/^["']|["']$/g, "")
					metadata[key] = val
				}
			})
		}
	}

	// Basic Markdown to HTML conversions
	const html = body.trim()

	// Escape HTML entities to prevent rendering bugs (except in code blocks we handle specifically)
	// But for simple rendering, let's process block-by-block.
	const lines = html.split("\n")
	const output = []
	let inCode = false
	let codeLang = ""
	let codeLines = []
	let inList = false
	let listType = "" // 'ul' or 'ol'
	let inTable = false
	let tableRows = []

	const closeList = () => {
		if (inList) {
			output.push(`</${listType}>`)
			inList = false
		}
	}

	const closeTable = () => {
		if (inTable) {
			output.push('<div class="table-wrapper"><table>')
			tableRows.forEach((row, rIdx) => {
				const isHeader = rIdx === 0 || (rIdx === 1 && row.every((cell) => cell.trim().startsWith("-")))
				if (rIdx === 1 && row.every((cell) => cell.trim().startsWith("-"))) {
					// Divider row, skip
					return
				}
				output.push("<tr>")
				row.forEach((cell) => {
					const tag = rIdx === 0 ? "th" : "td"
					output.push(`<${tag}>${inlineFormatting(cell.trim())}</${tag}>`)
				})
				output.push("</tr>")
			})
			output.push("</table></div>")
			inTable = false
			tableRows = []
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		// Handle code blocks
		if (line.trim().startsWith("```")) {
			if (inCode) {
				// End code block
				const escapedCode = codeLines.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
				output.push(`<pre><code class="language-${codeLang || "plaintext"}">${escapedCode}</code></pre>`)
				inCode = false
				codeLines = []
			} else {
				// Start code block
				closeList()
				closeTable()
				inCode = true
				codeLang = line.trim().slice(3).trim()
			}
			continue
		}

		if (inCode) {
			codeLines.push(line)
			continue
		}

		// Handle Tables
		if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
			closeList()
			inTable = true
			const cells = line.trim().split("|").slice(1, -1)
			tableRows.push(cells)
			continue
		}
		if (inTable) {
			closeTable()
		}

		// Handle Headings
		if (line.trim().startsWith("#")) {
			closeList()
			const match = line.match(/^(#{1,6})\s+(.*)$/)
			if (match) {
				const level = match[1].length
				const text = inlineFormatting(match[2])
				const id = match[2]
					.toLowerCase()
					.replace(/[^\w]+/g, "-")
					.replace(/(^-|-$)/g, "")
				output.push(`<h${level} id="${id}">${text}</h${level}>`)
				continue
			}
		}

		// Handle Bullet Lists
		const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/)
		if (bulletMatch) {
			if (!inList || listType !== "ul") {
				closeList()
				output.push("<ul>")
				inList = true
				listType = "ul"
			}
			output.push(`<li>${inlineFormatting(bulletMatch[2])}</li>`)
			continue
		}

		// Handle Numbered Lists
		const numMatch = line.match(/^(\s*)\d+\.\s+(.*)$/)
		if (numMatch) {
			if (!inList || listType !== "ol") {
				closeList()
				output.push("<ol>")
				inList = true
				listType = "ol"
			}
			output.push(`<li>${inlineFormatting(numMatch[2])}</li>`)
			continue
		}

		// Handle custom github-style Alert blocks
		const alertMatch = line.trim().match(/^>\s+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)
		if (alertMatch) {
			closeList()
			const alertType = alertMatch[1].toUpperCase()
			const alertContent = []
			// Read subsequent blockquote lines
			while (i + 1 < lines.length && lines[i + 1].trim().startsWith(">")) {
				i++
				alertContent.push(lines[i].trim().slice(1).trim())
			}
			output.push(`<div class="alert alert-${alertType.toLowerCase()}">
        <div class="alert-title">${alertType}</div>
        <p>${inlineFormatting(alertContent.join(" "))}</p>
      </div>`)
			continue
		}

		// Handle normal blockquotes
		if (line.trim().startsWith(">")) {
			closeList()
			const blockContent = [line.trim().slice(1).trim()]
			while (i + 1 < lines.length && lines[i + 1].trim().startsWith(">") && !lines[i + 1].trim().match(/^>\s+\[!/)) {
				i++
				blockContent.push(lines[i].trim().slice(1).trim())
			}
			output.push(`<blockquote>${inlineFormatting(blockContent.join(" "))}</blockquote>`)
			continue
		}

		// Handle horizontal rules
		if (line.trim() === "---" || line.trim() === "***" || line.trim() === "___") {
			closeList()
			output.push("<hr>")
			continue
		}

		// Handle paragraphs
		if (line.trim() === "") {
			closeList()
			continue
		}

		// Default paragraph
		closeList()
		output.push(`<p>${inlineFormatting(line)}</p>`)
	}

	// Final cleanup for open tags
	closeList()
	closeTable()

	return {
		metadata,
		html: output.join("\n"),
	}
}

// Inline formatting helper
function inlineFormatting(text) {
	return (
		text
			// Bold
			.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
			.replace(/__(.*?)__/g, "<strong>$1</strong>")
			// Italics
			.replace(/\*(.*?)\*/g, "<em>$1</em>")
			.replace(/_(.*?)_/g, "<em>$1</em>")
			// Inline code
			.replace(/`(.*?)`/g, "<code>$1</code>")
			// Links (Markdown style)
			.replace(/\[(.*?)\]\((.*?)\)/g, (match, label, url) => {
				// Re-map internal links ending with .md or .mdx to .html
				let finalUrl = url
				if (url.startsWith("file:///")) {
					// Strip file schema
					finalUrl = url.replace("file:///", "/")
				}
				if (finalUrl.endsWith(".md") || finalUrl.endsWith(".mdx")) {
					finalUrl = finalUrl.replace(/\.mdx?$/, ".html")
				}
				// Make paths relative for safety if they are absolute in workspace
				if (path.isAbsolute(finalUrl)) {
					finalUrl = finalUrl.replace(/.*\/docs\//, "/docs/")
				}
				return `<a href="${finalUrl}">${label}</a>`
			})
	)
}

// Custom CSS styling (Premium Dark Theme)
const CSS_TEMPLATE = `
:root {
  --bg-color: #0c0b0f;
  --panel-bg: rgba(22, 20, 28, 0.65);
  --panel-border: rgba(157, 78, 221, 0.15);
  --text-color: #e2dff0;
  --text-muted: #9f9bbf;
  --primary-color: #9D4EDD;
  --primary-glow: rgba(157, 78, 221, 0.35);
  --accent-color: #c77dff;
  --code-bg: #14121a;
  
  --note-color: #4361ee;
  --tip-color: #4cc9f0;
  --warning-color: #f72585;
  --important-color: #7209b7;
  --caution-color: #f72585;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: var(--bg-color);
  color: var(--text-color);
  line-height: 1.6;
  font-size: 16px;
  overflow-x: hidden;
  background-image: 
    radial-gradient(circle at 10% 20%, rgba(157, 78, 221, 0.08) 0%, transparent 40%),
    radial-gradient(circle at 90% 80%, rgba(199, 125, 255, 0.05) 0%, transparent 40%);
  background-attachment: fixed;
}

header {
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background-color: rgba(12, 11, 15, 0.75);
  border-bottom: 1px solid var(--panel-border);
  padding: 1.25rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logo-icon {
  width: 2.25rem;
  height: 2.25rem;
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  border-radius: 0.5rem;
  box-shadow: 0 0 10px var(--primary-glow);
}

.logo-title {
  font-family: 'Outfit', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, #ffffff 30%, #b8c0ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.nav-links {
  display: flex;
  gap: 1.5rem;
}

.nav-links a {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.95rem;
  font-weight: 500;
  transition: color 0.2s ease, text-shadow 0.2s ease;
}

.nav-links a:hover, .nav-links a.active {
  color: #ffffff;
  text-shadow: 0 0 8px var(--primary-glow);
}

.main-container {
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  min-height: calc(100vh - 5rem);
}

/* Sidebar styling */
.sidebar {
  width: 320px;
  border-right: 1px solid var(--panel-border);
  padding: 2rem;
  overflow-y: auto;
  flex-shrink: 0;
}

.sidebar-title {
  font-family: 'Outfit', sans-serif;
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-muted);
  margin-bottom: 1.25rem;
  padding-left: 0.5rem;
}

.sidebar-group {
  margin-bottom: 2rem;
}

.sidebar-group-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #ffffff;
  margin-bottom: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-left: 2px solid var(--primary-color);
}

.sidebar-group ul {
  list-style: none;
}

.sidebar-group li {
  margin-bottom: 0.5rem;
}

.sidebar-group a {
  display: block;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.9rem;
  padding: 0.35rem 0.5rem;
  border-radius: 0.25rem;
  transition: all 0.2s ease;
}

.sidebar-group a:hover {
  color: #ffffff;
  background-color: rgba(157, 78, 221, 0.08);
}

.sidebar-group a.active {
  color: #ffffff;
  font-weight: 600;
  background-color: rgba(157, 78, 221, 0.15);
  box-shadow: inset 0 0 4px rgba(157, 78, 221, 0.1);
}

/* Content Area */
.content {
  flex-grow: 1;
  padding: 3rem;
  max-width: 900px;
  margin: 0 auto;
}

.post-card {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 1rem;
  padding: 3rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

/* Typography styles inside content */
h1 {
  font-family: 'Outfit', sans-serif;
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1.25;
  margin-bottom: 1.5rem;
  background: linear-gradient(135deg, #ffffff 40%, #c77dff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

h2 {
  font-family: 'Outfit', sans-serif;
  font-size: 1.75rem;
  font-weight: 700;
  margin-top: 2.5rem;
  margin-bottom: 1.25rem;
  color: #ffffff;
  border-bottom: 1px solid rgba(157, 78, 221, 0.1);
  padding-bottom: 0.5rem;
}

h3 {
  font-family: 'Outfit', sans-serif;
  font-size: 1.35rem;
  font-weight: 600;
  margin-top: 2rem;
  margin-bottom: 0.75rem;
  color: #f0e6ff;
}

p {
  margin-bottom: 1.25rem;
  color: var(--text-color);
}

a {
  color: var(--accent-color);
  text-decoration: none;
  border-bottom: 1px dashed var(--primary-color);
  transition: all 0.2s ease;
}

a:hover {
  color: #ffffff;
  border-bottom-style: solid;
  text-shadow: 0 0 8px var(--primary-glow);
}

ul, ol {
  margin-bottom: 1.5rem;
  padding-left: 1.5rem;
}

li {
  margin-bottom: 0.5rem;
}

blockquote {
  border-left: 4px solid var(--primary-color);
  background-color: rgba(157, 78, 221, 0.05);
  padding: 1rem 1.5rem;
  margin-bottom: 1.5rem;
  border-radius: 0 0.5rem 0.5rem 0;
  font-style: italic;
  color: var(--text-muted);
}

/* Alert Boxes */
.alert {
  border-left: 4px solid var(--primary-color);
  padding: 1.25rem;
  margin: 1.5rem 0;
  border-radius: 0 0.75rem 0.75rem 0;
}
.alert p {
  margin-bottom: 0;
}
.alert-title {
  font-weight: 700;
  text-transform: uppercase;
  font-size: 0.8rem;
  letter-spacing: 1px;
  margin-bottom: 0.5rem;
}
.alert-note {
  border-left-color: var(--note-color);
  background-color: rgba(67, 97, 238, 0.06);
}
.alert-note .alert-title { color: var(--note-color); }

.alert-tip {
  border-left-color: var(--tip-color);
  background-color: rgba(76, 201, 240, 0.06);
}
.alert-tip .alert-title { color: var(--tip-color); }

.alert-warning {
  border-left-color: var(--warning-color);
  background-color: rgba(247, 37, 133, 0.06);
}
.alert-warning .alert-title { color: var(--warning-color); }

.alert-important {
  border-left-color: var(--important-color);
  background-color: rgba(114, 9, 183, 0.06);
}
.alert-important .alert-title { color: var(--important-color); }

.alert-caution {
  border-left-color: var(--caution-color);
  background-color: rgba(247, 37, 133, 0.06);
}
.alert-caution .alert-title { color: var(--caution-color); }

/* Tables */
.table-wrapper {
  overflow-x: auto;
  margin-bottom: 1.5rem;
  border: 1px solid var(--panel-border);
  border-radius: 0.5rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th, td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--panel-border);
}
th {
  background-color: rgba(157, 78, 221, 0.06);
  font-weight: 600;
  color: #ffffff;
}
tr:last-child td {
  border-bottom: none;
}

/* Code Syntax Highlight Layout */
pre {
  background-color: var(--code-bg);
  border: 1px solid var(--panel-border);
  border-radius: 0.5rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
  overflow-x: auto;
}
code {
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  font-size: 0.9rem;
}
:not(pre) > code {
  background-color: rgba(157, 78, 221, 0.12);
  color: var(--accent-color);
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
}

/* Index grid */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 2rem;
  margin-top: 2rem;
}
.card {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 1rem;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: transform 0.3s cubic-bezier(0.165, 0.84, 0.44, 1), box-shadow 0.3s ease;
}
.card:hover {
  transform: translateY(-5px);
  box-shadow: 0 12px 30px var(--primary-glow);
  border-color: rgba(157, 78, 221, 0.35);
}
.card-category {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 700;
  color: var(--accent-color);
  margin-bottom: 0.75rem;
}
.card-title {
  font-family: 'Outfit', sans-serif;
  font-size: 1.35rem;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 0.75rem;
}
.card-desc {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
  flex-grow: 1;
}
.card-link {
  align-self: flex-start;
  font-size: 0.9rem;
  font-weight: 600;
  border: none;
  color: #ffffff;
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  padding: 0.5rem 1.25rem;
  border-radius: 0.5rem;
  transition: opacity 0.2s;
}
.card-link:hover {
  opacity: 0.9;
  text-decoration: none;
  text-shadow: none;
}

/* Search Box */
.search-container {
  margin-bottom: 3rem;
}
.search-input {
  width: 100%;
  background: rgba(20, 18, 26, 0.8);
  border: 1px solid var(--panel-border);
  padding: 1rem 1.5rem;
  border-radius: 0.75rem;
  color: #ffffff;
  font-size: 1.05rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.search-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 12px var(--primary-glow);
}

.hero {
  padding: 4rem 0 3rem 0;
  text-align: center;
}
.hero h1 {
  font-size: 3.5rem;
  margin-bottom: 1rem;
}
.hero p {
  font-size: 1.2rem;
  color: var(--text-muted);
  max-width: 600px;
  margin: 0 auto;
}
`

// Main process function
function buildBlog() {
	const files = getMarkdownFiles(DOCS_DIR)
	console.log(`Found ${files.length} markdown files. Compiling...`)

	const pages = []

	// Compile individual pages
	files.forEach((filePath) => {
		const relativePath = path.relative(DOCS_DIR, filePath)
		const content = fs.readFileSync(filePath, "utf-8")

		// Parse
		const { metadata, html } = parseMarkdown(content)

		// Formulate HTML page name
		const htmlRelativePath = relativePath.replace(/\.mdx?$/, ".html")
		const destPath = path.join(BUILD_DIR, htmlRelativePath)

		// Ensure nested folder exists
		const destDir = path.dirname(destPath)
		if (!fs.existsSync(destDir)) {
			fs.mkdirSync(destDir, { recursive: true })
		}

		// Category calculation
		const category = path.dirname(relativePath) === "." ? "General" : path.dirname(relativePath)

		// Title fallback
		const title = metadata.title || metadata.sidebarTitle || path.basename(filePath, path.extname(filePath))
		const desc = metadata.description || "System documentation article."

		pages.push({
			title,
			description: desc,
			category,
			htmlPath: htmlRelativePath,
			originalPath: relativePath,
		})
	})

	// Sort pages alphabetically by category and title
	pages.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))

	// Build individual post pages
	pages.forEach((page) => {
		const fullSourcePath = path.join(DOCS_DIR, page.originalPath)
		const rawContent = fs.readFileSync(fullSourcePath, "utf-8")
		const { html } = parseMarkdown(rawContent)

		// Build sidebar HTML for this page
		const sidebarHtml = buildSidebar(pages, page.htmlPath)

		const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title} - LUMI Chronicles</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    ${CSS_TEMPLATE}
  </style>
</head>
<body>
  <header>
    <div class="logo-container">
      <div class="logo-icon"></div>
      <div class="logo-title">LUMI Chronicles</div>
    </div>
    <div class="nav-links">
      <a href="/index.html">Blog Home</a>
      <a href="#" class="active">Read Article</a>
    </div>
  </header>

  <div class="main-container">
    <aside class="sidebar">
      ${sidebarHtml}
    </aside>
    
    <main class="content">
      <article class="post-card">
        <h1>${page.title}</h1>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 2rem; display: flex; gap: 1rem;">
          <span>Category: <strong style="color: var(--accent-color);">${page.category.toUpperCase()}</strong></span>
        </div>
        ${html}
      </article>
    </main>
  </div>
</body>
</html>`

		const destPath = path.join(BUILD_DIR, page.htmlPath)
		fs.writeFileSync(destPath, pageHtml, "utf-8")
	})

	// Generate Index (Home Blog List) Page
	const sidebarHtmlIndex = buildSidebar(pages, "index.html")
	const cardsHtml = pages
		.map(
			(page) => `
    <div class="card" data-title="${page.title.toLowerCase()}" data-desc="${page.description.toLowerCase()}" data-category="${page.category.toLowerCase()}">
      <div>
        <div class="card-category">${page.category}</div>
        <div class="card-title">${page.title}</div>
        <div class="card-desc">${page.description}</div>
      </div>
      <a href="${page.htmlPath}" class="card-link">Read Paper</a>
    </div>
  `,
		)
		.join("\n")

	const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LUMI Chronicles - Docs & Papers Blog</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    ${CSS_TEMPLATE}
  </style>
</head>
<body>
  <header>
    <div class="logo-container">
      <div class="logo-icon"></div>
      <div class="logo-title">LUMI Chronicles</div>
    </div>
    <div class="nav-links">
      <a href="/index.html" class="active">Blog Home</a>
    </div>
  </header>

  <div class="main-container">
    <aside class="sidebar">
      ${sidebarHtmlIndex}
    </aside>
    
    <main class="content">
      <section class="hero">
        <h1>LUMI Chronicles</h1>
        <p>A compilation of engineering papers, philosophy briefs, and architecture blueprints for the calm coding agent platform.</p>
      </section>

      <div class="search-container">
        <input type="text" id="searchInput" class="search-input" placeholder="Search papers, categories, or keywords..." onkeyup="filterCards()">
      </div>

      <div class="grid" id="cardsGrid">
        ${cardsHtml}
      </div>
    </main>
  </div>

  <script>
    function filterCards() {
      const query = document.getElementById('searchInput').value.toLowerCase();
      const cards = document.querySelectorAll('.card');
      cards.forEach(card => {
        const title = card.getAttribute('data-title');
        const desc = card.getAttribute('data-desc');
        const category = card.getAttribute('data-category');
        if (title.includes(query) || desc.includes(query) || category.includes(query)) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`

	fs.writeFileSync(path.join(BUILD_DIR, "index.html"), indexHtml, "utf-8")
	console.log(`Successfully compiled index.html and all pages in ${BUILD_DIR}!`)
}

// Sidebar building utility
function buildSidebar(pages, activePath) {
	// Group by category
	const groups = {}
	pages.forEach((page) => {
		if (!groups[page.category]) {
			groups[page.category] = []
		}
		groups[page.category].push(page)
	})

	let sidebarHtml = '<div class="sidebar-title">TABLE OF CONTENTS</div>'

	Object.keys(groups).forEach((groupName) => {
		sidebarHtml += `<div class="sidebar-group">
      <div class="sidebar-group-title">${groupName.toUpperCase()}</div>
      <ul>`

		groups[groupName].forEach((page) => {
			// Calculate relative path from activePath context
			const relativeUrl = page.htmlPath

			// Calculate depth difference
			const activeDepth = activePath.split("/").length - 1
			const prefix = "../".repeat(activeDepth)
			const url = prefix + relativeUrl
			const isActive = activePath === page.htmlPath ? 'class="active"' : ""

			sidebarHtml += `<li><a href="${url}" ${isActive}>${page.title}</a></li>`
		})

		sidebarHtml += "</ul></div>"
	})

	return sidebarHtml
}

// Execute
buildBlog()
