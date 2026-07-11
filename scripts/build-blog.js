const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

// Target Directories
const DOCS_DIR = path.join(__dirname, "..", "docs")
const SUBPROJECT_DIR = path.join(__dirname, "..", "wiki-portal")
const DATA_FILE = path.join(SUBPROJECT_DIR, "src", "docs-data.json")
const DIST_DIR = path.join(SUBPROJECT_DIR, "dist")
const BUILD_DIR = path.join(__dirname, "..", "build-blog")

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

// Helper to get Git Metadata for a file (Last updated Author & Date)
function getGitMetadata(filePath) {
	try {
		const stdout = execSync(`git log -1 --format="%an|%ad" --date=short "${filePath}"`, {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
		})
		if (stdout && stdout.trim()) {
			const [author, date] = stdout.trim().split("|")
			return { author, date }
		}
	} catch (e) {
		// Fail silently
	}

	// Fallback to local file stats
	try {
		const stat = fs.statSync(filePath)
		const date = stat.mtime.toISOString().split("T")[0]
		return { author: "LUMI Compiler", date }
	} catch (e) {
		return { author: "Unknown", date: new Date().toISOString().split("T")[0] }
	}
}

// Simple Frontmatter & Markdown Parser supporting custom Tabs and sidebar_position
function parseMarkdown(content, relativePath = "") {
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

	const html = body.trim()
	const lines = html.split("\n")
	const output = []
	let inCode = false
	let codeLang = ""
	let codeLines = []
	let inList = false
	let listType = "" // 'ul' or 'ol'
	let inTable = false
	let tableRows = []
	const pageHeaders = [] // Array of { id, text, level } for the right-hand TOC

	// Tabs compilation variables
	let inTabs = false
	let tabCollection = [] // Array of { title, lines: [] }
	let currentTab = null

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
				if (rIdx === 1 && row.every((cell) => cell.trim().startsWith("-"))) {
					return
				}
				output.push("<tr>")
				row.forEach((cell) => {
					const tag = rIdx === 0 ? "th" : "td"
					output.push(`<${tag}>${inlineFormatting(cell.trim(), relativePath)}</${tag}>`)
				})
				output.push("</tr>")
			})
			output.push("</table></div>")
			inTable = false
			tableRows = []
		}
	}

	const closeTabContent = () => {
		if (currentTab) {
			tabCollection.push(currentTab)
			currentTab = null
		}
	}

	const compileTabsHtml = () => {
		if (tabCollection.length === 0) return ""

		// Build buttons and panels
		const buttonsHtml = tabCollection
			.map((tab, idx) => {
				const activeClass = idx === 0 ? "active" : ""
				return `<button class="tab-btn ${activeClass}" onclick="selectTab(this, ${idx})">${tab.title}</button>`
			})
			.join("\n")

		const panelsHtml = tabCollection
			.map((tab, idx) => {
				const activeClass = idx === 0 ? "active" : ""
				const panelContent = tab.lines.join("\n")
				const parsedPanel = parseMarkdown(panelContent, relativePath).html
				return `<div class="tab-panel ${activeClass}">${parsedPanel}</div>`
			})
			.join("\n")

		return `
      <div class="tabs-container">
        <div class="tabs-header">
          ${buttonsHtml}
        </div>
        <div class="tabs-content">
          ${panelsHtml}
        </div>
      </div>
    `
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]

		// Handle Tabs container delimiters
		if (line.trim() === ":::tabs") {
			closeList()
			closeTable()
			inTabs = true
			tabCollection = []
			currentTab = null
			continue
		}

		if (line.trim() === ":::") {
			if (inTabs) {
				closeTabContent()
				const tabsHtml = compileTabsHtml()
				output.push(tabsHtml)
				inTabs = false
				tabCollection = []
			}
			continue
		}

		// Handle Tab page start
		if (inTabs && line.trim().startsWith("::tab")) {
			closeTabContent()
			const titleMatch = line.match(/title="([^"]+)"/)
			const title = titleMatch ? titleMatch[1] : "Tab"
			currentTab = { title, lines: [] }
			continue
		}

		if (inTabs) {
			if (currentTab) {
				currentTab.lines.push(line)
			}
			continue
		}

		// Handle code blocks
		if (line.trim().startsWith("```")) {
			if (inCode) {
				const escapedCode = codeLines.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

				if (codeLang === "mermaid") {
					output.push(`<div class="mermaid">${codeLines.join("\n")}</div>`)
				} else {
					output.push(`
            <div class="code-block-container">
              <button class="copy-code-btn" onclick="copyCode(this)">Copy</button>
              <pre><code class="language-${codeLang || "plaintext"}">${escapedCode}</code></pre>
            </div>
          `)
				}
				inCode = false
				codeLines = []
			} else {
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

		// Handle Headings (H1 to H6)
		if (line.trim().startsWith("#")) {
			closeList()
			const match = line.match(/^(#{1,6})\s+(.*)$/)
			if (match) {
				const level = match[1].length
				const rawText = match[2]
				const text = inlineFormatting(rawText, relativePath)
				const id = rawText
					.toLowerCase()
					.replace(/[^\w\s-]/g, "")
					.replace(/\s+/g, "-")
					.replace(/-+/g, "-")
					.trim()

				if (level === 2 || level === 3) {
					pageHeaders.push({ id, text: rawText.replace(/[`*_\\]/g, ""), level })
				}

				output.push(`<h${level} id="${id}">
          ${text}
          <a class="header-anchor" href="#${id}" aria-hidden="true">#</a>
        </h${level}>`)
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
			output.push(`<li>${inlineFormatting(bulletMatch[2], relativePath)}</li>`)
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
			output.push(`<li>${inlineFormatting(numMatch[2], relativePath)}</li>`)
			continue
		}

		// Handle custom github-style Alert blocks
		const alertMatch = line.trim().match(/^>\s+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)
		if (alertMatch) {
			closeList()
			const alertType = alertMatch[1].toUpperCase()
			const alertContent = []
			while (i + 1 < lines.length && lines[i + 1].trim().startsWith(">")) {
				i++
				alertContent.push(lines[i].trim().slice(1).trim())
			}
			output.push(`<div class="alert alert-${alertType.toLowerCase()}">
        <div class="alert-header">
          <span class="alert-title">${alertType}</span>
        </div>
        <p>${inlineFormatting(alertContent.join(" "), relativePath)}</p>
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
			output.push(`<blockquote>${inlineFormatting(blockContent.join(" "), relativePath)}</blockquote>`)
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

		closeList()
		output.push(`<p>${inlineFormatting(line, relativePath)}</p>`)
	}

	closeList()
	closeTable()

	return {
		metadata,
		html: output.join("\n"),
		pageHeaders,
	}
}

// Inline formatting helper supporting namespace paths (docs vs papers)
function inlineFormatting(text, relativePath = "") {
	return (
		text
			.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
			.replace(/__(.*?)__/g, "<strong>$1</strong>")
			.replace(/\*(.*?)\*/g, "<em>$1</em>")
			.replace(/_(.*?)_/g, "<em>$1</em>")
			.replace(/`(.*?)`/g, "<code>$1</code>")
			// Router compatible relative links
			.replace(/\[(.*?)\]\((.*?)\)/g, (match, label, url) => {
				let finalUrl = url
				if (url.startsWith("file:///")) {
					finalUrl = url.replace("file:///", "/")
				}

				// Resolve clean route name (strip extensions)
				if (finalUrl.endsWith(".md") || finalUrl.endsWith(".mdx")) {
					finalUrl = finalUrl.replace(/\.mdx?$/, "")
				}

				// Reformat absolute docs namespace links
				if (path.isAbsolute(finalUrl)) {
					finalUrl = finalUrl.replace(/.*\/docs\//, "")
				} else {
					// Resolve relative links based on current file's folder position
					const currentDir = path.dirname(relativePath)
					if (currentDir !== ".") {
						finalUrl = path.join(currentDir, finalUrl).replace(/\\/g, "/")
					}
				}

				// Determine correct namespace hash prefix (docs or papers)
				const isPaper = finalUrl.startsWith("papers/") || relativePath.startsWith("papers/")
				const prefix = isPaper ? "#/papers/" : "#/docs/"

				return `<a href="${prefix}${finalUrl}">${label}</a>`
			})
	)
}

// Helper to copy directory recursively
function copyDirSync(src, dest) {
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, { recursive: true })
	}
	const entries = fs.readdirSync(src, { withFileTypes: true })
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name)
		const destPath = path.join(dest, entry.name)
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath)
		} else {
			fs.copyFileSync(srcPath, destPath)
		}
	}
}

// Main Build Process
function build() {
	const files = getMarkdownFiles(DOCS_DIR)
	console.log(`Scanning and compiling ${files.length} markdown documents...`)

	const pages = []

	files.forEach((filePath) => {
		const relativePath = path.relative(DOCS_DIR, filePath)
		const content = fs.readFileSync(filePath, "utf-8")

		// Parse markdown with relativePath context
		const { metadata, html, pageHeaders } = parseMarkdown(content, relativePath)

		// Formulate Router page path
		const routePath = relativePath.replace(/\.mdx?$/, "")

		// Category calculation
		const category = path.dirname(relativePath) === "." ? "General" : path.dirname(relativePath)

		// Title fallback
		const title = metadata.title || metadata.sidebarTitle || path.basename(filePath, path.extname(filePath))
		const desc = metadata.description || "System documentation article."

		// Sidebar sort position
		const sidebarPosition = metadata.sidebar_position ? Number.parseInt(metadata.sidebar_position, 10) : 999

		// Check if flagged as essential or recommended
		const isEssential = metadata.essential === "true" || metadata.recommended === "true"

		// Git metadata
		const { author, date } = getGitMetadata(filePath)

		// Read time
		const wordCount = content.split(/\s+/).length
		const readTime = Math.max(1, Math.ceil(wordCount / 220))

		pages.push({
			title,
			description: desc,
			category,
			path: routePath,
			html,
			pageHeaders,
			author,
			date,
			readTime,
			sidebarPosition,
			isEssential,
		})
	})

	// Sort pages category-wise first, then by sidebarPosition, then by title
	pages.sort((a, b) => {
		const catCompare = a.category.localeCompare(b.category)
		if (catCompare !== 0) return catCompare

		const posCompare = a.sidebarPosition - b.sidebarPosition
		if (posCompare !== 0) return posCompare

		return a.title.localeCompare(b.title)
	})

	// Write docs-data.json
	const dataDir = path.dirname(DATA_FILE)
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true })
	}
	fs.writeFileSync(DATA_FILE, JSON.stringify(pages, null, 2), "utf-8")
	console.log(`Successfully generated JSON database at ${DATA_FILE}!`)

	// Build the Vite project
	console.log("Building React Vite application...")
	execSync("npm run build", { cwd: SUBPROJECT_DIR, stdio: "inherit" })

	// Move build folder to target build-blog/ directory
	console.log(`Copying compiled SPA files to ${BUILD_DIR}...`)
	if (fs.existsSync(BUILD_DIR)) {
		fs.rmSync(BUILD_DIR, { recursive: true, force: true })
	}
	copyDirSync(DIST_DIR, BUILD_DIR)
	console.log("Wiki compilation and React SPA generation successful!")
}

build()
