import { useEffect, useRef, useState } from "react"
import { HashRouter, Link, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import docsDataRaw from "./docs-data.json"

interface PageHeader {
	id: string
	text: string
	level: number
}

interface PageData {
	title: string
	description: string
	category: string
	path: string // e.g. "papers/golden-cartridge-philosophy"
	html: string
	pageHeaders: PageHeader[]
	author: string
	date: string
	readTime: number
	sidebarPosition: number
	isEssential?: boolean
}

const docsData = docsDataRaw as PageData[]

// Tree structure interface for Sidebar
interface FileTreeNode {
	name: string
	path: string
	isDir: boolean
	children: Record<string, FileTreeNode>
	pageData?: PageData
}

// Helper to construct a hierarchical tree of files
function buildFileTree(pages: PageData[]): FileTreeNode {
	const root: FileTreeNode = {
		name: "root",
		path: "",
		isDir: true,
		children: {},
	}

	pages.forEach((page) => {
		const parts = page.path.split("/")
		let current = root
		let accumulatedPath = ""

		parts.forEach((part, idx) => {
			accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
			const isLast = idx === parts.length - 1

			if (!current.children[part]) {
				current.children[part] = {
					name: part,
					path: accumulatedPath,
					isDir: !isLast,
					children: {},
				}
			}

			if (isLast) {
				current.children[part].pageData = page
			}
			current = current.children[part]
		})
	})

	return root
}

// Curated Reading Pathways configuration
const LEARNING_TRACKS = {
	docs: [
		{
			title: "🚀 Fast-Track Quickstart",
			description: "Get up and running with LUMI in under 10 minutes. Read these in sequence:",
			steps: [
				{ path: "getting-started/quick-start", label: "LUMI Quick Start" },
				{ path: "getting-started/installation", label: "Installation Guide" },
				{ path: "getting-started/running-models-locally", label: "Local Model Setup" },
			],
		},
		{
			title: "🛡️ Core Hardening & Orchestration",
			description: "Understand safety bounds, forensic verification, and backing databases:",
			steps: [
				{ path: "api/execution-budgets", label: "Execution Budgets" },
				{ path: "core-features/forensic-grounding", label: "Forensic Grounding" },
				{ path: "api/database-engine-broccolidb", label: "BroccoliDB Storage" },
			],
		},
	],
	papers: [
		{
			title: "📜 The Golden Cartridge Framework",
			description: "Deep conceptual whitepapers establishing the anti-spiral engineering thesis:",
			steps: [
				{ path: "papers/golden-cartridge-philosophy", label: "Philosophy Whitepaper" },
				{ path: "papers/golden-cartridge-brief", label: "Conceptual Brief" },
				{ path: "papers/knowledge-item-thesis", label: "Knowledge Item Thesis" },
			],
		},
	],
}

export default function App() {
	const [theme, setTheme] = useState<"light" | "dark">(() => {
		const saved = localStorage.getItem("theme")
		return saved === "light" ? "light" : "dark"
	})

	// Track completed pages
	const [completedPages, setCompletedPages] = useState<string[]>(() => {
		try {
			const saved = localStorage.getItem("completed-pages")
			return saved ? JSON.parse(saved) : []
		} catch {
			return []
		}
	})

	// Curate toggle to hide/show non-essential items
	const [showEssentialOnly, setShowEssentialOnly] = useState<boolean>(() => {
		return localStorage.getItem("essential-only") === "true"
	})

	// Global spotlight search modal state
	const [spotlightOpen, setSpotlightOpen] = useState(false)

	useEffect(() => {
		if (theme === "light") {
			document.body.classList.add("light-theme")
		} else {
			document.body.classList.remove("light-theme")
		}
		localStorage.setItem("theme", theme)
	}, [theme])

	// Command-K keyboard shortcut listener
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault()
				setSpotlightOpen((prev) => !prev)
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [])

	const toggleTheme = () => {
		setTheme((prev) => (prev === "light" ? "dark" : "light"))
	}

	const togglePageCompleted = (path: string) => {
		setCompletedPages((prev) => {
			const updated = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
			localStorage.setItem("completed-pages", JSON.stringify(updated))
			return updated
		})
	}

	return (
		<HashRouter>
			<div className="app-container">
				<Routes>
					<Route element={<LandingPage setSpotlightOpen={setSpotlightOpen} toggleTheme={toggleTheme} />} path="/" />
					<Route
						element={
							<PortalDashboard
								completedPages={completedPages}
								namespace="docs"
								setShowEssentialOnly={setShowEssentialOnly}
								setSpotlightOpen={setSpotlightOpen}
								showEssentialOnly={showEssentialOnly}
								toggleTheme={toggleTheme}
							/>
						}
						path="/docs"
					/>
					<Route
						element={
							<PortalDashboard
								completedPages={completedPages}
								namespace="papers"
								setShowEssentialOnly={setShowEssentialOnly}
								setSpotlightOpen={setSpotlightOpen}
								showEssentialOnly={showEssentialOnly}
								toggleTheme={toggleTheme}
							/>
						}
						path="/papers"
					/>
					<Route
						element={
							<WikiLayout
								completedPages={completedPages}
								namespace="docs"
								setShowEssentialOnly={setShowEssentialOnly}
								setSpotlightOpen={setSpotlightOpen}
								showEssentialOnly={showEssentialOnly}
								togglePageCompleted={togglePageCompleted}
								toggleTheme={toggleTheme}
							/>
						}
						path="/docs/*"
					/>
					<Route
						element={
							<WikiLayout
								completedPages={completedPages}
								namespace="papers"
								setShowEssentialOnly={setShowEssentialOnly}
								setSpotlightOpen={setSpotlightOpen}
								showEssentialOnly={showEssentialOnly}
								togglePageCompleted={togglePageCompleted}
								toggleTheme={toggleTheme}
							/>
						}
						path="/papers/*"
					/>
				</Routes>

				{/* Global Spotlight Search Overlay */}
				<SpotlightModal isOpen={spotlightOpen} onClose={() => setSpotlightOpen(false)} />
			</div>
		</HashRouter>
	)
}

// ==========================================
// 1. Premium Product Landing Page (Home `/`)
// ==========================================
interface LandingProps {
	toggleTheme: () => void
	setSpotlightOpen: (val: boolean) => void
}

function LandingPage({ toggleTheme, setSpotlightOpen }: LandingProps) {
	const navigate = useNavigate()

	const themeToggleSvg = (
		<svg className="theme-toggle-icon" fill="currentColor" viewBox="0 0 24 24">
			<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-12.37c-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.38.39-1.02 0-1.41zm-12.37 12.37c-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.38.39-1.02 0-1.41z" />
		</svg>
	)

	return (
		<div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", overflowY: "auto" }}>
			<header>
				<div className="logo-container">
					<div className="logo-icon" />
					<div className="logo-title">LUMI</div>
				</div>
				<div className="nav-right">
					{/* Universal Header Search Button */}
					<div className="header-search-container">
						<button className="header-search-btn" onClick={() => setSpotlightOpen(true)}>
							<span>Search...</span>
							<span className="spotlight-kbd">⌘K</span>
						</button>
					</div>

					<div className="nav-links">
						<Link className="active" to="/">
							Home
						</Link>
						<Link to="/docs">Documentation</Link>
						<Link to="/papers">Whitepapers</Link>
					</div>
					<button aria-label="Toggle dark/light theme" className="theme-toggle-btn" onClick={toggleTheme}>
						{themeToggleSvg}
					</button>
				</div>
			</header>

			<main className="landing-container" style={{ flexGrow: 1 }}>
				<section className="landing-hero">
					<span className="landing-hero-tagline">Comfort-First Developer Tooling</span>
					<h1>LUMI - Calm Coding Companion</h1>
					<p>
						LUMI is a pair programming AI coding assistant designed for long, high-efficiency engineering sessions. It
						parses directives, executes governed operations, and audits codebases with deterministic control.
					</p>
					<div className="landing-ctas">
						<button
							className="landing-btn landing-btn-primary"
							onClick={() => navigate("/docs/getting-started/quick-start")}>
							Get Started
						</button>
						<button
							className="landing-btn landing-btn-secondary"
							onClick={() => navigate("/papers/papers/golden-cartridge-philosophy")}>
							Read Philosophy Papers
						</button>
					</div>
				</section>

				<section className="landing-features">
					<h2 className="landing-features-title">Architectural Pillars</h2>
					<div className="landing-grid">
						<div className="landing-card">
							<div className="landing-card-icon">
								<svg viewBox="0 0 24 24">
									<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z" />
								</svg>
							</div>
							<h3>Deterministic Execution</h3>
							<p>
								Applies execution budgets and automatic rollbacks to prevent runaway spirals and maintain
								sovereign codebase discipline.
							</p>
						</div>

						<div className="landing-card">
							<div className="landing-card-icon">
								<svg viewBox="0 0 24 24">
									<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 15l-4-4 1.41-1.41L10 13.17l5.59-5.59L17 9l-7 7z" />
								</svg>
							</div>
							<h3>Forensic Auditing</h3>
							<p>
								Senses repository dependencies and resolves imports dynamically to verify grounding soundness and
								prevent runtime failures.
							</p>
						</div>

						<div className="landing-card">
							<div className="landing-card-icon">
								<svg viewBox="0 0 24 24">
									<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
								</svg>
							</div>
							<h3>Comfort-First UX</h3>
							<p>
								Designed for long sessions, utilizing responsive dark-theme glassmorphism and clear Outfit
								typography to reduce cognitive load.
							</p>
						</div>

						<div className="landing-card">
							<div className="landing-card-icon">
								<svg viewBox="0 0 24 24">
									<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
								</svg>
							</div>
							<h3>Governed Subagents</h3>
							<p>
								Orchestrates nested agent nodes under strict parent authority boundaries, executing complex
								workflows safely.
							</p>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	)
}

// ==========================================
// 2. Portal Dashboard (Docs or Papers lists)
// ==========================================
interface PortalProps {
	namespace: "docs" | "papers"
	toggleTheme: () => void
	completedPages: string[]
	showEssentialOnly: boolean
	setShowEssentialOnly: (val: boolean) => void
	setSpotlightOpen: (val: boolean) => void
}

function PortalDashboard({
	namespace,
	toggleTheme,
	completedPages,
	showEssentialOnly,
	setShowEssentialOnly,
	setSpotlightOpen,
}: PortalProps) {
	const [activeCategory, setActiveCategory] = useState<string | null>(null)
	const [referenceOpen, setReferenceOpen] = useState(false)
	const location = useLocation()

	// Folder filter from breadcrumbs query params
	const folderFilter = new URLSearchParams(location.search).get("folder")

	// Filter docs data based on active namespace segment
	let namespaceData = docsData.filter((page) => {
		const isPaper = page.path.startsWith("papers/") || page.category === "papers"
		return namespace === "papers" ? isPaper : !isPaper
	})

	// Apply folder filtration if clicking crumbs folders
	if (folderFilter) {
		namespaceData = namespaceData.filter((page) => page.path.startsWith(folderFilter + "/") || page.path === folderFilter)
	}

	// Filter by category bubble if selected
	if (activeCategory) {
		namespaceData = namespaceData.filter((page) => page.category === activeCategory)
	}

	// Apply "Essential Only" toggle filtration
	let displayCards = namespaceData
	if (showEssentialOnly) {
		displayCards = namespaceData.filter((p) => p.isEssential)
	}

	// Get unique categories
	const allUniqueCategories = Array.from(
		new Set(
			docsData
				.filter((page) => {
					const isPaper = page.path.startsWith("papers/") || page.category === "papers"
					return namespace === "papers" ? isPaper : !isPaper
				})
				.map((p) => p.category),
		),
	).sort()

	// Sidebar tree nodes filtering: hide reference tree nodes if "Essential Only" is active
	const sidebarData = showEssentialOnly ? namespaceData.filter((p) => p.isEssential) : namespaceData
	const fileTreeRoot = buildFileTree(sidebarData)

	const themeToggleSvg = (
		<svg className="theme-toggle-icon" fill="currentColor" viewBox="0 0 24 24">
			<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-12.37c-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.38.39-1.02 0-1.41zm-12.37 12.37c-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.38.39-1.02 0-1.41z" />
		</svg>
	)

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
			<header>
				<div className="logo-container">
					<div className="logo-icon" />
					<div className="logo-title">LUMI {namespace === "papers" ? "Whitepapers" : "Docs"}</div>
				</div>

				{/* Curated controls header */}
				<div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
					{/* Universal Header Search Button */}
					<div className="header-search-container">
						<button className="header-search-btn" onClick={() => setSpotlightOpen(true)}>
							<span>Search...</span>
							<span className="spotlight-kbd">⌘K</span>
						</button>
					</div>

					<div className="essential-switch-container">
						<span>Essential Only</span>
						<label className="switch-toggle">
							<input
								checked={showEssentialOnly}
								onChange={(e) => {
									setShowEssentialOnly(e.target.checked)
									localStorage.setItem("essential-only", e.target.checked.toString())
								}}
								type="checkbox"
							/>
							<span className="switch-slider" />
						</label>
					</div>

					<div className="nav-right" style={{ borderLeft: "1px solid var(--panel-border)", paddingLeft: "1.25rem" }}>
						<div className="nav-links">
							<Link to="/">Home</Link>
							<Link className={namespace === "docs" ? "active" : ""} to="/docs">
								Documentation
							</Link>
							<Link className={namespace === "papers" ? "active" : ""} to="/papers">
								Whitepapers
							</Link>
						</div>
						<button aria-label="Toggle dark/light theme" className="theme-toggle-btn" onClick={toggleTheme}>
							{themeToggleSvg}
						</button>
					</div>
				</div>
			</header>

			<div className="main-container" style={{ flexGrow: 1 }}>
				{/* Hierarchical Sidebar */}
				<aside className="sidebar-left" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
					<div style={{ flexGrow: 1, overflowY: "auto" }}>
						<div className="nav-title">EXPLORER</div>
						<FileTree activePath="" completedPages={completedPages} namespace={namespace} treeNode={fileTreeRoot} />
					</div>

					{/* Active track widget at bottom of Left Sidebar */}
					<SidebarProgressWidget completedPages={completedPages} namespace={namespace} />
				</aside>

				{/* Dashboard Content Grid */}
				<div
					className="content-pane"
					style={{ flexGrow: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
					<div className="wiki-wrapper" style={{ flexGrow: 1 }}>
						<div className="breadcrumbs">
							<Link to="/">Home</Link>
							<span className="breadcrumbs-separator">/</span>
							<Link to={`/${namespace}`}>{namespace === "papers" ? "Whitepapers" : "Docs"}</Link>
							{folderFilter && (
								<>
									<span className="breadcrumbs-separator">/</span>
									<span style={{ color: "var(--text-color)" }}>{folderFilter.replace(/-/g, " ")}</span>
								</>
							)}
						</div>

						<section className="wiki-hero">
							<h1
								style={{
									background: "linear-gradient(135deg, var(--text-color) 40%, var(--accent-color) 100%)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}>
								{namespace === "papers" ? "LUMI Research Papers" : "LUMI Technical Portal"}
							</h1>
							<p>
								{namespace === "papers"
									? "Explore the philosophy, conceptual briefs, and system thesis underlying the calm coding design strategy."
									: "Access technical specifications, API structures, running models locally, and customization workflows."}
							</p>
						</section>

						{/* CURATED READING PATHS / LEARNING TRACKS SECTION */}
						{!folderFilter && !activeCategory && (
							<section className="learning-tracks-section">
								<div className="learning-tracks-header">
									<span>🗺️</span> Curated Reading Tracks
								</div>
								<div className="tracks-grid">
									{LEARNING_TRACKS[namespace].map((track, tIdx) => {
										const totalReadTime = track.steps.reduce((sum, step) => {
											const matchedPage = docsData.find((p) => p.path === step.path)
											return sum + (matchedPage?.readTime || 2)
										}, 0)

										const completedCount = track.steps.filter((step) =>
											completedPages.includes(step.path),
										).length
										const completionPercent = Math.round((completedCount / track.steps.length) * 100)

										return (
											<div className="track-card" key={tIdx}>
												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														alignItems: "center",
														marginBottom: "0.5rem",
													}}>
													<div className="track-card-title">{track.title}</div>
													<span className="track-duration-pill">⏱️ {totalReadTime} min</span>
												</div>
												<div className="track-card-desc">{track.description}</div>

												<div
													style={{
														display: "flex",
														justifyContent: "space-between",
														fontSize: "0.75rem",
														color: "var(--text-muted)",
														marginBottom: "0.35rem",
													}}>
													<span>Track Progress</span>
													<span
														style={{
															fontWeight: 600,
															color:
																completionPercent === 100
																	? "var(--tip-color)"
																	: "var(--text-color)",
														}}>
														{completionPercent}%
													</span>
												</div>
												<div className="track-progress-container">
													<div
														className="track-progress-fill"
														style={{
															width: `${completionPercent}%`,
															backgroundColor: completionPercent === 100 ? "var(--tip-color)" : "",
														}}
													/>
												</div>

												<div className="track-steps">
													{track.steps.map((step, sIdx) => {
														const isStepDone = completedPages.includes(step.path)
														return (
															<Link
																className="track-step-item"
																key={sIdx}
																to={`/${namespace}/${step.path}`}>
																<span
																	className="track-step-badge"
																	style={{
																		backgroundColor: isStepDone ? "var(--tip-color)" : "",
																	}}>
																	{isStepDone ? "✓" : sIdx + 1}
																</span>
																<span
																	className="track-step-title"
																	style={{
																		textDecoration: isStepDone ? "line-through" : "none",
																		color: isStepDone ? "var(--text-muted)" : "",
																	}}>
																	{step.label}
																</span>
																<span className="track-step-arrow">→</span>
															</Link>
														)
													})}
												</div>
											</div>
										)
									})}
								</div>
							</section>
						)}

						{/* Category Filter Bubbles */}
						{!folderFilter && (
							<div className="filter-bubble-container">
								<button
									className={`filter-bubble ${activeCategory === null ? "active" : ""}`}
									onClick={() => setActiveCategory(null)}>
									All Categories
								</button>
								{allUniqueCategories.map((cat) => (
									<button
										className={`filter-bubble ${activeCategory === cat ? "active" : ""}`}
										key={cat}
										onClick={() => setActiveCategory(cat)}>
										{cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, " ")}
									</button>
								))}
								{activeCategory !== null && (
									<button className="clear-filter-btn" onClick={() => setActiveCategory(null)}>
										Clear Filter ×
									</button>
								)}
							</div>
						)}

						{/* ESSENTIAL CARDS GRID (Always visible at top of library section) */}
						<div style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1.25rem", color: "var(--text-color)" }}>
							⭐ Must-Read Specifications
						</div>
						<div className="wiki-grid" style={{ marginBottom: "2.5rem" }}>
							{displayCards
								.filter((p) => p.isEssential)
								.map((page) => {
									const isPageDone = completedPages.includes(page.path)
									return (
										<div
											className="wiki-card"
											key={page.path}
											style={{
												borderLeft: isPageDone ? "4px solid var(--tip-color)" : "",
												borderTop: "2px solid var(--primary-color)",
											}}>
											<span className="wiki-card-badge-essential">Essential</span>
											{isPageDone && (
												<span
													className="wiki-card-badge-essential"
													style={{
														right: "5.5rem",
														backgroundColor: "rgba(16, 185, 129, 0.12)",
														color: "var(--tip-color)",
														borderColor: "rgba(16, 185, 129, 0.25)",
													}}>
													Read ✓
												</span>
											)}
											<div>
												<button
													className="wiki-card-category"
													onClick={() => setActiveCategory(page.category)}
													style={{
														background: "transparent",
														border: "none",
														cursor: "pointer",
														padding: 0,
														textAlign: "left",
														outline: "none",
													}}>
													{page.category}
												</button>
												<div className="wiki-card-title">{page.title}</div>
												<div className="wiki-card-desc">{page.description}</div>
											</div>
											<Link
												className="wiki-card-link"
												style={{ border: "none", color: "#ffffff" }}
												to={`/${namespace}/${page.path}`}>
												Explore spec
											</Link>
										</div>
									)
								})}
						</div>

						{/* Collapsible reference library panel (to hide 200+ cards) */}
						{!showEssentialOnly && (
							<div className="collapsible-reference-container" style={{ marginBottom: "3rem" }}>
								<button className="collapsible-reference-header" onClick={() => setReferenceOpen(!referenceOpen)}>
									<span>📁 Reference Library ({displayCards.length} articles)</span>
									<span>{referenceOpen ? "▲ Collapse reference" : "▼ Show all reference documents"}</span>
								</button>
								{referenceOpen && (
									<div className="collapsible-reference-body">
										<div className="wiki-grid">
											{displayCards.map((page) => {
												const isPageDone = completedPages.includes(page.path)
												return (
													<div
														className="wiki-card"
														key={page.path}
														style={{ borderLeft: isPageDone ? "4px solid var(--tip-color)" : "" }}>
														{page.isEssential && (
															<span className="wiki-card-badge-essential">Essential</span>
														)}
														{isPageDone && (
															<span
																className="wiki-card-badge-essential"
																style={{
																	right: page.isEssential ? "5.5rem" : "1rem",
																	backgroundColor: "rgba(16, 185, 129, 0.12)",
																	color: "var(--tip-color)",
																	borderColor: "rgba(16, 185, 129, 0.25)",
																}}>
																Read ✓
															</span>
														)}
														<div>
															<button
																className="wiki-card-category"
																onClick={() => setActiveCategory(page.category)}
																style={{
																	background: "transparent",
																	border: "none",
																	cursor: "pointer",
																	padding: 0,
																	textAlign: "left",
																	outline: "none",
																}}>
																{page.category}
															</button>
															<div className="wiki-card-title">{page.title}</div>
															<div className="wiki-card-desc">{page.description}</div>
														</div>
														<Link
															className="wiki-card-link"
															style={{ border: "none", color: "#ffffff" }}
															to={`/${namespace}/${page.path}`}>
															Explore spec
														</Link>
													</div>
												)
											})}
										</div>
									</div>
								)}
							</div>
						)}
					</div>

					<Footer />
				</div>
			</div>
		</div>
	)
}

// ==========================================
// 3. Three-column Wiki Article Viewer Layout
// ==========================================
interface WikiLayoutProps {
	namespace: "docs" | "papers"
	toggleTheme: () => void
	completedPages: string[]
	togglePageCompleted: (path: string) => void
	showEssentialOnly: boolean
	setShowEssentialOnly: (val: boolean) => void
	setSpotlightOpen: (val: boolean) => void
}

function WikiLayout({
	namespace,
	toggleTheme,
	completedPages,
	togglePageCompleted,
	showEssentialOnly,
	setShowEssentialOnly,
	setSpotlightOpen,
}: WikiLayoutProps) {
	const location = useLocation()
	const navigate = useNavigate()

	// Extract path: location.pathname starts with "/docs/" or "/papers/"
	const prefixPath = `/${namespace}/`
	const routeParam = location.pathname.substring(prefixPath.length)

	// Filter docs data based on active namespace segment
	const namespaceData = docsData.filter((page) => {
		const isPaper = page.path.startsWith("papers/") || page.category === "papers"
		return namespace === "papers" ? isPaper : !isPaper
	})

	const activePage = namespaceData.find((page) => page.path === routeParam) || namespaceData[0]

	const contentPaneRef = useRef<HTMLDivElement>(null)
	const progressBarRef = useRef<HTMLDivElement>(null)
	const [scrollProgress, setScrollProgress] = useState(0)
	const [backToTopVisible, setBackToTopVisible] = useState(false)
	const [activeTocId, setActiveTocId] = useState("")
	const [searchQuery, setSearchQuery] = useState("")
	const sidebarSearchRef = useRef<HTMLInputElement>(null)
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

	// Accordion folder state management loaded from localStorage
	const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
		const initial: Record<string, boolean> = {}
		if (activePage) {
			const parts = activePage.path.split("/")
			let currentPath = ""
			parts.forEach((part) => {
				currentPath = currentPath ? `${currentPath}/${part}` : part
				initial[currentPath] = true
			})
		}
		return initial
	})

	const toggleFolder = (folderPath: string) => {
		setExpandedFolders((prev) => {
			const updated = { ...prev, [folderPath]: !prev[folderPath] }
			localStorage.setItem("folder-collapsed-" + folderPath, (!updated[folderPath]).toString())
			return updated
		})
	}

	// Handle shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "/" && document.activeElement !== sidebarSearchRef.current) {
				e.preventDefault()
				sidebarSearchRef.current?.focus()
				sidebarSearchRef.current?.select()
			}
			if (e.key === "Escape") {
				sidebarSearchRef.current?.blur()
				setMobileSidebarOpen(false)
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [])

	// Update scroll triggers, spy headings, and progress
	useEffect(() => {
		const contentPane = contentPaneRef.current
		if (!contentPane) return

		const handleScroll = () => {
			const totalHeight = contentPane.scrollHeight - contentPane.clientHeight
			const scrolled = totalHeight > 0 ? (contentPane.scrollTop / totalHeight) * 100 : 0
			setScrollProgress(scrolled)
			setBackToTopVisible(contentPane.scrollTop > 300)

			// Scroll Spy TOC
			const headings = Array.from(contentPane.querySelectorAll("h2, h3"))
			if (headings.length > 0) {
				let currentActive = ""
				const triggerBound = contentPane.getBoundingClientRect().top + 120

				for (let i = 0; i < headings.length; i++) {
					const rect = headings[i].getBoundingClientRect()
					if (rect.top <= triggerBound) {
						currentActive = headings[i].id
					} else {
						break
					}
				}
				if (!currentActive) {
					currentActive = headings[0].id
				}
				setActiveTocId(currentActive)
			}
		}

		contentPane.addEventListener("scroll", handleScroll)
		contentPane.scrollTop = 0
		setScrollProgress(0)
		setMobileSidebarOpen(false)

		// Expand parent folders of active file when navigating
		if (activePage) {
			const parts = activePage.path.split("/")
			let currentPath = ""
			setExpandedFolders((prev) => {
				const updated = { ...prev }
				parts.forEach((part) => {
					currentPath = currentPath ? `${currentPath}/${part}` : part
					updated[currentPath] = true
				})
				return updated
			})
		}

		return () => contentPane.removeEventListener("scroll", handleScroll)
	}, [location.pathname, activePage])

	// Client-side Mermaid and Prism loader
	useEffect(() => {
		const win = window as any
		if (win.mermaid) {
			win.mermaid.contentLoaded()
		}
		if (win.Prism) {
			win.Prism.highlightAll()
		}
	}, [activePage])

	// Click-to-Scroll layout targeting with offset
	useEffect(() => {
		const contentPane = contentPaneRef.current
		if (!contentPane) return

		const handleAnchorClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			const anchor = target.closest("a")
			if (anchor) {
				const href = anchor.getAttribute("href")

				// Internal page header anchors
				if (href && href.startsWith("#") && !href.startsWith("#/docs/") && !href.startsWith("#/papers/")) {
					e.preventDefault()
					const targetId = href.substring(1)
					const el = document.getElementById(targetId)
					if (el) {
						const topOffset = el.offsetTop - 50
						contentPane.scrollTo({ top: topOffset, behavior: "smooth" })
						window.location.hash = href
					}
				} else if (href && (href.startsWith("#/docs/") || href.startsWith("#/papers/"))) {
					// Cross page relative routes
					e.preventDefault()
					const route = href.substring(1) // strip leading '#'
					navigate(route)
				}
			}
		}

		contentPane.addEventListener("click", handleAnchorClick)
		return () => contentPane.removeEventListener("click", handleAnchorClick)
	}, [navigate])

	const scrollToTop = () => {
		contentPaneRef.current?.scrollTo({ top: 0, behavior: "smooth" })
	}

	const themeToggleSvg = (
		<svg className="theme-toggle-icon" fill="currentColor" viewBox="0 0 24 24">
			<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-12.37c-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.38.39-1.02 0-1.41zm-12.37 12.37c-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06c.39-.38.39-1.02 0-1.41z" />
		</svg>
	)

	const backToTopArrowSvg = (
		<svg className="back-to-top-icon" fill="currentColor" viewBox="0 0 24 24">
			<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
		</svg>
	)

	const hamburgerSvg = (
		<svg className="mobile-menu-icon" viewBox="0 0 24 24">
			<path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
		</svg>
	)

	// Navigate links calculations
	const activeIdx = namespaceData.findIndex((page) => page.path === activePage.path)
	const prevPage = activeIdx > 0 ? namespaceData[activeIdx - 1] : null
	const nextPage = activeIdx < namespaceData.length - 1 ? namespaceData[activeIdx + 1] : null

	// Build Hierarchical File Tree for Sidebar
	const sidebarData = showEssentialOnly ? namespaceData.filter((p) => p.isEssential) : namespaceData
	const fileTreeRoot = buildFileTree(sidebarData)

	// Build Multi-Level breadcrumbs nodes
	const crumbSegments = activePage.path.split("/")
	let accumulatedFolder = ""
	const breadcrumbsList = crumbSegments.map((segment, index) => {
		accumulatedFolder = accumulatedFolder ? `${accumulatedFolder}/${segment}` : segment
		const isLast = index === crumbSegments.length - 1
		const title = segment.replace(/-/g, " ")

		if (isLast) {
			return (
				<span key={index} style={{ color: "var(--text-color)" }}>
					{activePage.title}
					{activePage.isEssential && (
						<span
							className="essential-badge"
							style={{ verticalAlign: "middle", transform: "scale(0.85)", transformOrigin: "left" }}>
							Essential
						</span>
					)}
				</span>
			)
		}

		return (
			<span key={index}>
				<Link to={`/${namespace}?folder=${accumulatedFolder}`}>{title.charAt(0).toUpperCase() + title.slice(1)}</Link>
				<span className="breadcrumbs-separator">/</span>
			</span>
		)
	})

	const isPageCompleted = completedPages.includes(activePage.path)

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
			<header>
				<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
					<button
						aria-label="Toggle navigation drawer"
						className="mobile-menu-btn"
						onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}>
						{hamburgerSvg}
					</button>
					<div className="logo-container">
						<div className="logo-icon" />
						<div className="logo-title">LUMI {namespace === "papers" ? "Whitepapers" : "Docs"}</div>
					</div>
				</div>

				{/* Curated controls header */}
				<div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
					{/* Universal Header Search Button */}
					<div className="header-search-container">
						<button className="header-search-btn" onClick={() => setSpotlightOpen(true)}>
							<span>Search...</span>
							<span className="spotlight-kbd">⌘K</span>
						</button>
					</div>

					<div className="essential-switch-container">
						<span>Essential Only</span>
						<label className="switch-toggle">
							<input
								checked={showEssentialOnly}
								onChange={(e) => {
									setShowEssentialOnly(e.target.checked)
									localStorage.setItem("essential-only", e.target.checked.toString())
								}}
								type="checkbox"
							/>
							<span className="switch-slider" />
						</label>
					</div>

					<div className="nav-right" style={{ borderLeft: "1px solid var(--panel-border)", paddingLeft: "1.25rem" }}>
						<div className="nav-links">
							<Link to="/">Home</Link>
							<Link className={namespace === "docs" ? "active" : ""} to="/docs">
								Documentation
							</Link>
							<Link className={namespace === "papers" ? "active" : ""} to="/papers">
								Whitepapers
							</Link>
						</div>
						<button aria-label="Toggle dark/light theme" className="theme-toggle-btn" onClick={toggleTheme}>
							{themeToggleSvg}
						</button>
					</div>
				</div>
			</header>

			{/* Progress Indicator */}
			<div className="progress-container">
				<div className="progress-bar" ref={progressBarRef} style={{ width: `${scrollProgress}%` }} />
			</div>

			<div className="main-container" style={{ flexGrow: 1 }}>
				{/* Left Collapsible Accordion Sidebar */}
				<aside
					className={`sidebar-left ${mobileSidebarOpen ? "open" : ""}`}
					style={{ display: "flex", flexDirection: "column", height: "100%" }}>
					<div style={{ flexGrow: 1, overflowY: "auto" }}>
						<div className="sidebar-search-box">
							<input
								className="sidebar-search"
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Search pages... (Press '/' to focus)"
								ref={sidebarSearchRef}
								type="text"
								value={searchQuery}
							/>
							<span className="search-shortcut-hint">/</span>
						</div>

						<div className="nav-title">EXPLORER</div>
						<FileTree
							activePath={activePage.path}
							completedPages={completedPages}
							expandedFolders={expandedFolders}
							namespace={namespace}
							searchQuery={searchQuery}
							toggleFolder={toggleFolder}
							treeNode={fileTreeRoot}
						/>
					</div>

					{/* Active track widget at bottom of Left Sidebar */}
					<SidebarProgressWidget completedPages={completedPages} namespace={namespace} />
				</aside>

				{/* Backdrop for mobile menu drawer */}
				{mobileSidebarOpen && (
					<div
						onClick={() => setMobileSidebarOpen(false)}
						style={{
							position: "fixed",
							top: "3.5rem",
							left: 0,
							right: 0,
							bottom: 0,
							background: "rgba(0,0,0,0.4)",
							zIndex: 101,
							backdropFilter: "blur(4px)",
							WebkitBackdropFilter: "blur(4px)",
						}}
					/>
				)}

				{/* Center Panel Content Reader */}
				<div
					className="content-pane"
					ref={contentPaneRef}
					style={{ flexGrow: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
					<div className="wiki-wrapper" style={{ flexGrow: 1 }}>
						<div className="breadcrumbs">
							<Link to="/">Home</Link>
							<span className="breadcrumbs-separator">/</span>
							<Link to={`/${namespace}`}>{namespace === "papers" ? "Whitepapers" : "Docs"}</Link>
							<span className="breadcrumbs-separator">/</span>
							{breadcrumbsList}
						</div>

						<main className="wiki-article">
							<h1>
								{activePage.title}
								{activePage.isEssential && (
									<span className="essential-badge" style={{ verticalAlign: "middle", marginLeft: "1rem" }}>
										Essential
									</span>
								)}
							</h1>

							<div className="article-meta-row">
								<div className="meta-badges">
									<span className="meta-badge">{activePage.category}</span>
									<span
										className="meta-badge"
										style={{ backgroundColor: "rgba(16, 185, 129, 0.08)", color: "var(--tip-color)" }}>
										⏱️ {activePage.readTime} min read
									</span>
								</div>
								<div className="git-metadata">
									<span>
										Last updated: <strong>{activePage.date}</strong> by <strong>{activePage.author}</strong>
									</span>
								</div>
							</div>

							{/* Render parsed HTML markdown body */}
							<div dangerouslySetInnerHTML={{ __html: activePage.html }} />

							{/* Mark as Completed Button */}
							<div className="mark-read-container">
								<button
									className={`mark-read-btn ${isPageCompleted ? "completed" : ""}`}
									onClick={() => togglePageCompleted(activePage.path)}>
									{isPageCompleted ? "✓ Completed (Click to Mark Unread)" : "Mark as Completed"}
								</button>
							</div>

							{/* Next/Prev Navigation buttons */}
							{(prevPage || nextPage) && (
								<div className="wiki-page-navigation" style={{ marginTop: "2.5rem", marginBottom: "3rem" }}>
									{prevPage && (
										<Link className="wiki-page-nav-link" to={`/${namespace}/${prevPage.path}`}>
											<span>← Previous</span>
											<div className="wiki-page-nav-link-title">{prevPage.title}</div>
										</Link>
									)}
									{nextPage && (
										<Link className="wiki-page-nav-link next-link" to={`/${namespace}/${nextPage.path}`}>
											<span>Next →</span>
											<div className="wiki-page-nav-link-title">{nextPage.title}</div>
										</Link>
									)}
								</div>
							)}
						</main>
					</div>

					{/* Floating Back To Top Button */}
					<button
						aria-label="Back to top"
						className={`back-to-top-btn ${backToTopVisible ? "visible" : ""}`}
						id="backToTop"
						onClick={scrollToTop}>
						{backToTopArrowSvg}
					</button>

					<Footer />
				</div>

				{/* Right Sidebar TOC */}
				<aside className="sidebar-right">
					<div className="toc-title">On This Page</div>
					{activePage.pageHeaders.length > 0 ? (
						<ul className="toc-list">
							{activePage.pageHeaders.map((header, hIdx) => {
								const depthClass = header.level === 3 ? "toc-depth-3" : ""
								const isActive = activeTocId === header.id
								return (
									<li className="toc-item" key={hIdx}>
										<a
											className={`toc-link ${depthClass} ${isActive ? "active" : ""}`}
											href={`#${header.id}`}>
											{header.text}
										</a>
									</li>
								)
							})}
						</ul>
					) : (
						<p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No sections found.</p>
					)}
				</aside>
			</div>
		</div>
	)
}

// ==========================================
// Sidebar Reading Track Progress Widget
// ==========================================
interface SidebarWidgetProps {
	namespace: "docs" | "papers"
	completedPages: string[]
}

function SidebarProgressWidget({ namespace, completedPages }: SidebarWidgetProps) {
	const tracks = LEARNING_TRACKS[namespace]

	let activeTrack = tracks.find((track) => {
		return track.steps.some((step) => !completedPages.includes(step.path))
	})

	if (!activeTrack) {
		activeTrack = tracks[0]
	}

	const nextStep = activeTrack.steps.find((step) => !completedPages.includes(step.path))

	if (!nextStep) {
		return (
			<div
				className="sidebar-progress-widget"
				style={{
					background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)",
					borderColor: "rgba(16, 185, 129, 0.2)",
				}}>
				<div className="widget-title" style={{ color: "var(--tip-color)" }}>
					CONGRATULATIONS 🎉
				</div>
				<div className="widget-name" style={{ fontSize: "0.8rem", margin: 0 }}>
					All tracks completed!
				</div>
			</div>
		)
	}

	const completedCount = activeTrack.steps.filter((step) => completedPages.includes(step.path)).length
	const progressText = `${completedCount}/${activeTrack.steps.length} Steps`

	return (
		<div className="sidebar-progress-widget">
			<div className="widget-title">RESUME PATHWAY ({progressText})</div>
			<div className="widget-name" title={nextStep.label}>
				{nextStep.label}
			</div>
			<Link className="widget-btn" to={`/${namespace}/${nextStep.path}`}>
				Read Next →
			</Link>
		</div>
	)
}

// ==========================================
// Global Spotlight Search Overlay Modal
// ==========================================
interface SpotlightProps {
	isOpen: boolean
	onClose: () => void
}

function SpotlightModal({ isOpen, onClose }: SpotlightProps) {
	const [query, setQuery] = useState("")
	const [activeIndex, setActiveIndex] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const resultsRef = useRef<HTMLDivElement>(null)
	const navigate = useNavigate()

	useEffect(() => {
		if (isOpen) {
			setQuery("")
			setActiveIndex(0)
			setTimeout(() => inputRef.current?.focus(), 50)
		}
	}, [isOpen])

	// Handle escape to close, keyboard arrows to select, enter to navigate
	useEffect(() => {
		if (!isOpen) return

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose()
			}
		}
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [isOpen, onClose])

	if (!isOpen) return null

	const getFilteredMatches = () => {
		const trimmed = query.trim().toLowerCase()
		if (!trimmed) {
			// Show default essential articles when query is empty!
			return docsData
				.filter((p) => p.isEssential)
				.map((p) => ({
					title: p.title,
					category: p.category,
					description: p.description,
					path: p.path,
				}))
		}

		const matches: Array<{
			title: string
			category: string
			description: string
			path: string
		}> = []

		docsData.forEach((item) => {
			if (
				item.title.toLowerCase().includes(trimmed) ||
				item.description.toLowerCase().includes(trimmed) ||
				item.category.toLowerCase().includes(trimmed) ||
				item.html.toLowerCase().includes(trimmed)
			) {
				matches.push({
					title: item.title,
					category: item.category,
					description: item.description,
					path: item.path,
				})
			}
		})

		return matches.slice(0, 8) // Limit to top 8 spotlight results
	}

	const matches = getFilteredMatches()

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (matches.length === 0) return
		if (e.key === "ArrowDown") {
			e.preventDefault()
			setActiveIndex((prev) => Math.min(prev + 1, matches.length - 1))
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			setActiveIndex((prev) => Math.max(prev - 1, 0))
		} else if (e.key === "Enter") {
			e.preventDefault()
			const selected = matches[activeIndex]
			if (selected) {
				const isPaper = selected.path.startsWith("papers/") || selected.category === "papers"
				navigate(`/${isPaper ? "papers" : "docs"}/${selected.path}`)
				onClose()
			}
		}
	}

	return (
		<div className="spotlight-backdrop" onClick={onClose}>
			<div className="spotlight-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
				<div className="spotlight-search-header">
					<span style={{ fontSize: "1.2rem" }}>🔍</span>
					<input
						className="spotlight-search-input"
						onChange={(e) => {
							setQuery(e.target.value)
							setActiveIndex(0)
						}}
						placeholder="Type page title, topic, or category..."
						ref={inputRef}
						type="text"
						value={query}
					/>
					<span className="spotlight-kbd" onClick={onClose} style={{ cursor: "pointer" }}>
						ESC
					</span>
				</div>

				<div className="spotlight-results" ref={resultsRef}>
					{matches.length > 0 ? (
						matches.map((match, idx) => {
							const isPaper = match.path.startsWith("papers/") || match.category === "papers"
							return (
								<Link
									className={`spotlight-result-item ${activeIndex === idx ? "selected" : ""}`}
									key={match.path}
									onClick={onClose}
									onMouseEnter={() => setActiveIndex(idx)}
									to={`/${isPaper ? "papers" : "docs"}/${match.path}`}>
									<span className="spotlight-result-category">{match.category}</span>
									<span className="spotlight-result-title">{match.title}</span>
									<span className="spotlight-result-desc">{match.description}</span>
								</Link>
							)
						})
					) : (
						<div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.9rem" }}>
							No matches found for "{query}"
						</div>
					)}
				</div>

				<div className="spotlight-footer">
					<div className="spotlight-kbd-guide">
						<span>
							<span className="spotlight-kbd">↑↓</span> Navigate
						</span>
						<span>
							<span className="spotlight-kbd">⏎</span> Select
						</span>
					</div>
					<div>Spotlight Search</div>
				</div>
			</div>
		</div>
	)
}

// ==========================================
// 4. World-Class Multi-Column Footer Component
// ==========================================
function Footer() {
	return (
		<footer style={{ marginTop: "auto", background: "var(--bg-color)" }}>
			<div className="footer-columns-container">
				<div className="footer-column footer-brand">
					<div className="footer-brand-logo">
						<div className="logo-icon" />
						<div className="logo-title">LUMI</div>
					</div>
					<p className="footer-brand-text">
						Comfort-First Developer Tooling.
						<br />
						Deterministic orchestration & calm pairing sessions.
					</p>
					<div className="footer-social-row">
						<a
							aria-label="LUMI GitHub Repository"
							className="footer-social-link"
							href="https://github.com/CardSorting/LUMI">
							<svg fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
								<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
							</svg>
						</a>
					</div>
				</div>

				<div className="footer-column">
					<span className="footer-column-title">Documentation</span>
					<ul className="footer-column-links">
						<li>
							<Link to="/docs/getting-started/quick-start">Quick Start</Link>
						</li>
						<li>
							<Link to="/docs/getting-started/installation">Installation</Link>
						</li>
						<li>
							<Link to="/docs/getting-started/running-models-locally">Running Models</Link>
						</li>
						<li>
							<Link to="/docs/api/database-engine-broccolidb">BroccoliDB Specification</Link>
						</li>
					</ul>
				</div>

				<div className="footer-column">
					<span className="footer-column-title">Research</span>
					<ul className="footer-column-links">
						<li>
							<Link to="/papers/papers/golden-cartridge-philosophy">Philosophy Papers</Link>
						</li>
						<li>
							<Link to="/papers/papers/golden-cartridge-brief">Conceptual Briefs</Link>
						</li>
						<li>
							<Link to="/papers/papers/knowledge-item-thesis">Knowledge Item Thesis</Link>
						</li>
					</ul>
				</div>

				<div className="footer-column">
					<span className="footer-column-title">Community</span>
					<ul className="footer-column-links">
						<li>
							<a href="https://github.com/CardSorting/LUMI">GitHub Project</a>
						</li>
						<li>
							<a href="https://github.com/CardSorting/LUMI/issues">Issue Tracker</a>
						</li>
						<li>
							<a href="https://github.com/CardSorting/LUMI/discussions">Discussions</a>
						</li>
					</ul>
				</div>
			</div>

			<div className="footer-bottom-bar">
				<span>© {new Date().getFullYear()} DietCode Inc. Apache-2.0 Licensed.</span>
				<div style={{ display: "flex", gap: "1.5rem" }}>
					<Link
						style={{ textDecoration: "none", color: "inherit", border: "none" }}
						to="/docs/getting-started/quick-start">
						Privacy Policy
					</Link>
					<Link
						style={{ textDecoration: "none", color: "inherit", border: "none" }}
						to="/docs/getting-started/quick-start">
						Terms of Service
					</Link>
				</div>
			</div>
		</footer>
	)
}

// ==========================================
// Helper Folder Tree Sidebar Renderers
// ==========================================
interface FileTreeProps {
	treeNode: FileTreeNode
	namespace: "docs" | "papers"
	activePath: string
	isRoot?: boolean
	expandedFolders?: Record<string, boolean>
	toggleFolder?: (path: string) => void
	searchQuery?: string
	completedPages: string[]
}

function FileTree({
	treeNode,
	namespace,
	activePath,
	isRoot = true,
	expandedFolders = {},
	toggleFolder = () => {},
	searchQuery = "",
	completedPages,
}: FileTreeProps) {
	const sortedKeys = Object.keys(treeNode.children).sort((keyA, keyB) => {
		const nodeA = treeNode.children[keyA]
		const nodeB = treeNode.children[keyB]

		if (nodeA.isDir && !nodeB.isDir) return -1
		if (!nodeA.isDir && nodeB.isDir) return 1

		if (nodeA.isDir && nodeB.isDir) {
			return nodeA.name.localeCompare(nodeB.name)
		}

		const posA = nodeA.pageData?.sidebarPosition ?? 999
		const posB = nodeB.pageData?.sidebarPosition ?? 999
		if (posA !== posB) return posA - posB

		return nodeA.name.localeCompare(nodeB.name)
	})

	const filteredKeys = sortedKeys.filter((key) => {
		const node = treeNode.children[key]
		if (!searchQuery.trim()) return true

		const matchNode = (n: FileTreeNode): boolean => {
			if (!n.isDir) {
				return (n.pageData?.title ?? "").toLowerCase().includes(searchQuery.toLowerCase())
			}
			return Object.keys(n.children).some((childKey) => matchNode(n.children[childKey]))
		}

		return matchNode(node)
	})

	if (filteredKeys.length === 0 && !isRoot) return null

	return (
		<ul className={`tree-node-container ${isRoot ? "root-level" : ""}`}>
			{filteredKeys.map((key) => {
				const node = treeNode.children[key]

				if (node.isDir) {
					const isOpen = expandedFolders[node.path] || searchQuery.trim() !== ""
					const folderDisplayName = node.name.charAt(0).toUpperCase() + node.name.slice(1).replace(/-/g, " ")

					return (
						<li key={node.path}>
							<button className="tree-folder-toggle" onClick={() => toggleFolder(node.path)}>
								<div className="tree-folder-title-left">
									<span>📁</span>
									<span>{folderDisplayName}</span>
								</div>
								<svg
									className="tree-arrow-icon"
									style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
									viewBox="0 0 24 24">
									<path d="M7 10l5 5 5-5H7z" />
								</svg>
							</button>
							{isOpen && (
								<FileTree
									activePath={activePath}
									completedPages={completedPages}
									expandedFolders={expandedFolders}
									isRoot={false}
									namespace={namespace}
									searchQuery={searchQuery}
									toggleFolder={toggleFolder}
									treeNode={node}
								/>
							)}
						</li>
					)
				}

				const fileData = node.pageData
				if (!fileData) return null

				const isActiveFile = activePath === fileData.path
				const isFileCompleted = completedPages.includes(fileData.path)

				return (
					<li key={fileData.path}>
						<Link
							className={`tree-file-link ${isActiveFile ? "active" : ""} ${isFileCompleted ? "completed" : ""}`}
							to={`/${namespace}/${fileData.path}`}>
							<span>📄 {fileData.title}</span>
							{fileData.isEssential && (
								<span className="essential-badge" style={{ transform: "scale(0.8)", marginLeft: "0.35rem" }}>
									Essential
								</span>
							)}
						</Link>
					</li>
				)
			})}
		</ul>
	)
}

// Global script helpers
;(window as any).copyCode = (btn: HTMLButtonElement) => {
	const container = btn.closest(".code-block-container")
	if (!container) return
	const code = (container.querySelector("code") as HTMLElement).innerText
	navigator.clipboard.writeText(code).then(() => {
		btn.innerText = "Copied!"
		btn.style.background = "var(--tip-color)"
		btn.style.borderColor = "var(--tip-color)"
		setTimeout(() => {
			btn.innerText = "Copy"
			btn.style.background = ""
			btn.style.borderColor = ""
		}, 2000)
	})
}

;(window as any).selectTab = (btn: HTMLButtonElement, idx: number) => {
	const container = btn.closest(".tabs-container")
	if (!container) return
	const buttons = container.querySelectorAll(".tab-btn")
	const panels = container.querySelectorAll(".tab-panel")
	buttons.forEach((b, i) => {
		if (i === idx) b.classList.add("active")
		else b.classList.remove("active")
	})
	panels.forEach((p, i) => {
		if (i === idx) p.classList.add("active")
		else p.classList.remove("active")
	})
}
