import { JoyZoningAuditProgress, JoyZoningAuditResponse } from "@shared/proto/dietcode/joyzoning"
import { useCallback, useEffect, useRef, useState } from "react"
import styled, { keyframes } from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { JoyZoningServiceClient } from "@/services/grpc-client"
import ViewHeader from "../common/ViewHeader"

const asArray = <T,>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : [])
const asRecord = (value: Record<string, number> | null | undefined): Record<string, number> =>
	value && typeof value === "object" && !Array.isArray(value) ? value : {}
const asNumber = (value: number | null | undefined, fallback = 0): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback
const asText = (value: string | null | undefined, fallback = ""): string => (typeof value === "string" ? value : fallback)
const lower = (value: string | null | undefined): string => asText(value).toLowerCase()
const fixed = (value: number | null | undefined, digits = 1): string => asNumber(value).toFixed(digits)

const JoyZoningView = ({ onDone }: { onDone: () => void }) => {
	const { environment } = useExtensionState()
	const [loading, setLoading] = useState(false)
	const [report, setReport] = useState<JoyZoningAuditResponse | null>(null)
	const [progress, setProgress] = useState<JoyZoningAuditProgress | null>(null)
	const [previewPlan, setPreviewPlan] = useState<string | null>(null)
	const [selectedOptimizations, setSelectedOptimizations] = useState<Set<number>>(new Set())

	const [status, setStatus] = useState<"idle" | "starting" | "streaming" | "completed" | "error" | "cancelled">("idle")
	const [launchingTaskId, setLaunchingTaskId] = useState<string | null>(null)
	const [auditLaunchMessage, setAuditLaunchMessage] = useState<string | null>(null)
	const [auditLaunchError, setAuditLaunchError] = useState<string | null>(null)
	const [activeTab, setActiveTab] = useState<"overview" | "fixes" | "improvements">("overview")
	const [fixesSearch, setFixesSearch] = useState("")
	const [optsSearch, setOptsSearch] = useState("")
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

	const cancelRef = useRef<(() => void) | null>(null)
	const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
	const mountedRef = useRef(true)

	const violations = asArray(report?.violations)
	const optimizations = asArray(report?.optimizations)
	const history = asArray(report?.history)
	const topRecommendations = asArray(report?.topRecommendations)
	const layerScores = asRecord(report?.layerScores)
	const riskProfileValues = { LOW: 0, MEDIUM: 0, HIGH: 0, ...asRecord(report?.riskProfile) }
	const progressCurrentFile = asText(progress?.currentFile, "Preparing...")
	const progressPercentage = asNumber(progress?.percentage, 0)

	const cleanupTimers = useCallback(() => {
		for (const timer of timersRef.current) {
			clearTimeout(timer)
		}
		timersRef.current = []
	}, [])

	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			if (cancelRef.current) {
				cancelRef.current()
			}
			cleanupTimers()
		}
	}, [cleanupTimers])

	const triggerAudit = useCallback(() => {
		if (status === "starting" || status === "streaming") {
			return
		}

		// Cancel any existing stream
		if (cancelRef.current) {
			cancelRef.current()
			cancelRef.current = null
		}

		setLoading(true)
		setStatus("starting")
		setAuditLaunchError(null)
		setAuditLaunchMessage(null)
		setReport(null)
		setProgress(null)

		try {
			const cancel = JoyZoningServiceClient.triggerAudit(
				{ path: "", useCache: false },
				{
					onResponse: (response) => {
						setStatus("streaming")
						if (response.progress) {
							setProgress(response.progress)
						}
						// If response has violations or health info, it's a partial or final report
						if (
							(response.violations && response.violations.length > 0) ||
							(response.optimizations && response.optimizations.length > 0) ||
							response.integrityScore > 0 ||
							response.buildHealth > 0
						) {
							setReport(response)
						}
					},
					onError: (error) => {
						setStatus("error")
						setLoading(false)
						setAuditLaunchError(error.message)
						cancelRef.current = null
					},
					onComplete: () => {
						setStatus("completed")
						setLoading(false)
						setAuditLaunchMessage("Audit complete.")
						cancelRef.current = null
					},
				},
			)
			cancelRef.current = cancel
		} catch (error) {
			console.error("Failed to trigger JoyZoning audit:", error)
			setStatus("error")
			setLoading(false)
			setAuditLaunchError(error instanceof Error ? error.message : "Failed to start audit.")
		}
	}, [status])

	const copyReportToClipboard = () => {
		if (!report) return
		const summary = `
Project Health Report (${new Date().toLocaleDateString()})
Grade: ${asText(report.grade, "--")}
Health: ${asNumber(report.buildHealth)}%
Critical Fixes: ${violations.length}
Optimizations: ${optimizations.length}
Stability: ${asNumber(report.stabilityScore)}%
Organization: ${asNumber(report.maintainabilityScore)}%
		`.trim()
		navigator.clipboard.writeText(summary)
		setAuditLaunchMessage("Report summary copied to clipboard!")
		const timer = setTimeout(() => {
			if (mountedRef.current) setAuditLaunchMessage(null)
		}, 3000)
		timersRef.current.push(timer)
	}

	const executeRefactor = async (action: string, path: string, dryRun = false) => {
		if (!action || !path) {
			setAuditLaunchError("Missing action or path for refactor.")
			return
		}

		try {
			const response = await JoyZoningServiceClient.executeRefactor({ action, path, dryRun })
			if (dryRun) {
				setPreviewPlan(response.planSummary || "No plan summary available.")
			} else if (response.success) {
				setLaunchingTaskId(`${action}:${path}`)
				const timer = setTimeout(() => setLaunchingTaskId(null), 5000)
				timersRef.current.push(timer)
			} else if (response.message) {
				setAuditLaunchError(`Refactor failed: ${response.message}`)
			}
		} catch (error) {
			console.error("Refactor failed:", error)
			setAuditLaunchError(error instanceof Error ? error.message : "Refactor execution failed.")
		}
	}

	const toggleOptimizationSelection = (index: number) => {
		setSelectedOptimizations((prev) => {
			const next = new Set(prev)
			if (next.has(index)) next.delete(index)
			else next.add(index)
			return next
		})
	}

	const handleBatchRefactor = async () => {
		if (selectedOptimizations.size === 0) return

		setLoading(true)
		setAuditLaunchError(null)
		setAuditLaunchMessage(null)

		try {
			const requests = Array.from(selectedOptimizations).map((index) => {
				const opt = optimizations[index]
				return {
					action: opt.action,
					path: opt.path,
					dryRun: false,
				}
			})

			const response = await JoyZoningServiceClient.executeBatchRefactor({
				requests,
				dryRun: false,
			})

			if (response.success) {
				setLaunchingTaskId("batch")
				setAuditLaunchMessage(response.message)
				setPreviewPlan(response.planSummary)
				setSelectedOptimizations(new Set())
			} else {
				setAuditLaunchError(response.message)
			}
		} catch (e) {
			setAuditLaunchError(asText((e as Error).message, "Failed to launch batch refactor"))
		} finally {
			setLoading(false)
		}
	}

	return (
		<Container>
			<ViewHeader environment={environment} onDone={onDone} title="Project Health Center" />
			<Content>
				<HeroSection>
					{report?.driftDetected && (
						<DriftWarning>
							<WarningIcon>🔄</WarningIcon>
							<WarningText>Sync Alert: {report.driftCount} files out of sync with index.</WarningText>
						</DriftWarning>
					)}
					<RadarContainer>
						<RadarRing $loading={loading} $percentage={progressPercentage} />
						<GradeValue $grade={report?.grade || "A"}>{report ? report.grade : loading ? "..." : "--"}</GradeValue>
						<HealthLabel>
							{loading ? "Scanning codebase..." : "Overall Health Grade"}
							{report && asNumber(report.healthDelta) !== 0 && (
								<DeltaBadge $positive={asNumber(report.healthDelta) > 0}>
									{asNumber(report.healthDelta) > 0 ? "↑" : "↓"}
									{Math.abs(asNumber(report.healthDelta)).toFixed(1)}%
								</DeltaBadge>
							)}
						</HealthLabel>
					</RadarContainer>

					<HeaderStats>
						<SubstrateStatus $health={report?.buildHealth || 100}>
							{loading ? "ANALYZING..." : (report?.buildHealth || 100) > 80 ? "● OPERATIONAL" : "● ACTION REQUIRED"}
						</SubstrateStatus>
						{report && <QualityGate $status={report.qualityGateStatus}>{report.qualityGateStatus}</QualityGate>}
						{report && (
							<ShareButton onClick={copyReportToClipboard} title="Copy health summary to clipboard">
								<span>📋</span> Share
							</ShareButton>
						)}
					</HeaderStats>
				</HeroSection>

				<TabContainer>
					<Tab $active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
						Overview
					</Tab>
					<Tab $active={activeTab === "fixes"} onClick={() => setActiveTab("fixes")}>
						Critical Fixes{" "}
						{violations.length > 0 ? (
							<>
								({violations.length})
								{asNumber(report?.violationDelta) !== 0 && (
									<DeltaInline $positive={asNumber(report?.violationDelta) < 0}>
										{asNumber(report?.violationDelta) > 0 ? "+" : ""}
										{asNumber(report?.violationDelta)}
									</DeltaInline>
								)}
							</>
						) : (
							""
						)}
					</Tab>
					<Tab $active={activeTab === "improvements"} onClick={() => setActiveTab("improvements")}>
						Optimizations {optimizations.length > 0 ? `(${optimizations.length})` : ""}
					</Tab>
				</TabContainer>
				{loading && (
					<ScanningNotice>
						<ScanningIcon>🔍</ScanningIcon>
						<ScanningText>Analyzing project architecture and structural patterns...</ScanningText>
					</ScanningNotice>
				)}

				{!report && !loading && (
					<WelcomeView>
						<WelcomeIcon>🏥</WelcomeIcon>
						<WelcomeTitle>Welcome to Health Center</WelcomeTitle>
						<WelcomeDesc>
							Scan your project to identify structural risks, maintainability hotspots, and architectural debt. Our
							AI-driven analysis provides actionable remediation paths for a solid foundation.
						</WelcomeDesc>
						<AuditButton $primary onClick={triggerAudit} style={{ width: "auto", padding: "12px 24px" }}>
							Start Initial Health Scan
						</AuditButton>
					</WelcomeView>
				)}

				{activeTab === "overview" && report && (
					<TabView>
						<HealthSnapshot $health={report.buildHealth}>
							<SnapshotIcon>{report.buildHealth > 80 ? "✨" : report.buildHealth > 50 ? "⚡" : "🚨"}</SnapshotIcon>
							<SnapshotContent>
								<SnapshotTitleGroup>
									<SnapshotTitle>Health Snapshot</SnapshotTitle>
									{history.length > 1 && (
										<TrendSparkline title="Recent Health Trend">
											<svg height="15" viewBox="0 0 100 20" width="60">
												<title>Health Trend Sparkline</title>
												<polyline
													fill="none"
													points={history
														.slice(-10)
														.map((p, i) => `${i * 10},${20 - (asNumber(p.health) / 100) * 15}`)
														.join(" ")}
													stroke={report.healthDelta >= 0 ? "#52c41a" : "#ff4d4f"}
													strokeWidth="2"
												/>
											</svg>
										</TrendSparkline>
									)}
								</SnapshotTitleGroup>
								<SnapshotDesc>
									{report.buildHealth > 80
										? "Project foundations are solid. No immediate structural action required."
										: report.buildHealth > 50
											? "The system is stable but shows signs of organizational debt."
											: "Critical structural risks detected. Immediate maintenance recommended."}
								</SnapshotDesc>
							</SnapshotContent>
						</HealthSnapshot>

						<RadarChartSection>
							<RadarChartWrapper>
								<svg height="100%" viewBox="0 0 200 200" width="100%">
									<title>Architectural Health Radar</title>
									{/* Background Hexagon */}
									<polygon
										fill="rgba(255,255,255,0.03)"
										points="100,20 170,60 170,140 100,180 30,140 30,60"
										stroke="rgba(255,255,255,0.1)"
										strokeWidth="1"
									/>
									{/* Data Polygon (Simulated for visualization) */}
									<polygon
										fill="rgba(24, 144, 255, 0.2)"
										points={`
											100,${100 - (report.complianceScore / 100) * 80} 
											${100 + (report.stabilityScore / 100) * 70},${100 - (report.stabilityScore / 100) * 40}
											${100 + (report.maintainabilityScore / 100) * 70},${100 + (report.maintainabilityScore / 100) * 40}
											100,${100 + (report.buildHealth / 100) * 80}
											${100 - (report.integrityScore / 100) * 70},${100 + (report.integrityScore / 100) * 40}
											${100 - (report.complianceScore / 100) * 70},${100 - (report.complianceScore / 100) * 40}
										`}
										stroke="var(--vscode-button-background)"
										strokeWidth="2"
									/>
								</svg>
								<RadarLabel style={{ top: "0%", left: "50%", transform: "translateX(-50%)" }}>
									Best Practices
								</RadarLabel>
								<RadarLabel style={{ top: "25%", right: "-10%" }}>Stability</RadarLabel>
								<RadarLabel style={{ bottom: "25%", right: "-10%" }}>Maintainability</RadarLabel>
								<RadarLabel style={{ bottom: "0%", left: "50%", transform: "translateX(-50%)" }}>
									Overall
								</RadarLabel>
								<RadarLabel style={{ bottom: "25%", left: "-10%" }}>Integrity</RadarLabel>
								<RadarLabel style={{ top: "25%", left: "-10%" }}>Compliance</RadarLabel>
							</RadarChartWrapper>
						</RadarChartSection>
						{report && violations.length > 0 && (
							<NextActionCard onClick={() => setActiveTab("fixes")}>
								<NextActionIcon>🚀</NextActionIcon>
								<NextActionContent>
									<NextActionTitle>Next Recommended Step</NextActionTitle>
									<NextActionDesc>
										Address the <strong>{violations.length} critical issues</strong> identified in your
										foundations to improve system stability.
									</NextActionDesc>
								</NextActionContent>
								<NextActionArrow>→</NextActionArrow>
							</NextActionCard>
						)}
						<GovernanceGrid>
							<GovernanceCard>
								<GovernanceTitle>Best Practices</GovernanceTitle>
								<GovernanceValue>{report?.complianceScore || 0}%</GovernanceValue>
								<GovernanceDesc>Structural Alignment</GovernanceDesc>
							</GovernanceCard>
							<GovernanceCard $toxic={!!report?.toxicModule}>
								<GovernanceTitle>Attention Needed</GovernanceTitle>
								<GovernanceValue style={{ fontSize: "11px", opacity: 0.9 }}>
									{report?.toxicModule || "None"}
								</GovernanceValue>
								<GovernanceDesc>Highest Risk Area</GovernanceDesc>
							</GovernanceCard>
						</GovernanceGrid>

						{report && (
							<ChecklistSection>
								<SectionHeader>
									<SectionTitle>Health Checklist</SectionTitle>
									<StatLabel>Core Requirements</StatLabel>
								</SectionHeader>
								<Checklist>
									<CheckItem $passed={(report.buildHealth || 0) > 70}>
										<CheckIcon>{(report.buildHealth || 0) > 70 ? "✅" : "❌"}</CheckIcon>
										<CheckText>Base Integrity Score {report.buildHealth || 0}%</CheckText>
									</CheckItem>
									<CheckItem $passed={!report.driftDetected}>
										<CheckIcon>{!report.driftDetected ? "✅" : "❌"}</CheckIcon>
										<CheckText>
											{!report.driftDetected ? "Index synchronized" : "Substrate drift detected"}
										</CheckText>
									</CheckItem>
									<CheckItem $passed={(report.complianceScore || 0) > 80}>
										<CheckIcon>{(report.complianceScore || 0) > 80 ? "✅" : "⚠️"}</CheckIcon>
										<CheckText>Standard alignment</CheckText>
									</CheckItem>
									<CheckItem $passed={(report.stabilityScore || 0) > 60}>
										<CheckIcon>{(report.stabilityScore || 0) > 60 ? "✅" : "⚠️"}</CheckIcon>
										<CheckText>System stability baseline</CheckText>
									</CheckItem>
								</Checklist>
							</ChecklistSection>
						)}

						{report?.riskProfile && (
							<RiskProfileSection>
								<SectionHeader>
									<SectionTitle>Project Risk Distribution</SectionTitle>
									<StatLabel>File Health</StatLabel>
								</SectionHeader>
								<RiskBar>
									<RiskSegment
										$total={report.totalFiles}
										$type="LOW"
										$width={riskProfileValues.LOW || 0}
										title="Low Risk"
									/>
									<RiskSegment
										$total={report.totalFiles}
										$type="MEDIUM"
										$width={riskProfileValues.MEDIUM || 0}
										title="Medium Risk"
									/>
									<RiskSegment
										$total={report.totalFiles}
										$type="HIGH"
										$width={riskProfileValues.HIGH || 0}
										title="High Risk"
									/>
								</RiskBar>
								<RiskLegend>
									<LegendItem>
										<Dot $type="LOW" /> Low
									</LegendItem>
									<LegendItem>
										<Dot $type="MEDIUM" /> Medium
									</LegendItem>
									<LegendItem>
										<Dot $type="HIGH" /> High Risk
									</LegendItem>
								</RiskLegend>
							</RiskProfileSection>
						)}

						{topRecommendations.length > 0 && (
							<QuickWinsSection>
								<SectionHeader>
									<SectionTitle>Top Recommendations</SectionTitle>
									<Badge $type="HIGH">QUICK WINS</Badge>
								</SectionHeader>
								<QuickWinsGrid>
									{topRecommendations.map((opt) => (
										<QuickWinCard key={opt.title} onClick={() => setActiveTab("improvements")}>
											<QuickWinIcon>⚡</QuickWinIcon>
											<QuickWinContent>
												<QuickWinTitle>{opt.title}</QuickWinTitle>
												<QuickWinGain>+{fixed(opt.projectedHealthGain)}% Health Boost</QuickWinGain>
											</QuickWinContent>
										</QuickWinCard>
									))}
								</QuickWinsGrid>
							</QuickWinsSection>
						)}

						<MissionSection>
							<SectionHeader>
								<SectionTitle>Guided Missions</SectionTitle>
								<StatLabel>Recommended Actions</StatLabel>
							</SectionHeader>
							<MissionGrid>
								<MissionCard $active={violations.length > 0}>
									<MissionStatus>{violations.length > 0 ? "ACTION REQUIRED" : "STABLE"}</MissionStatus>
									<MissionTitle>Harden Infrastructure</MissionTitle>
									<MissionDesc>Resolve {violations.length} critical risks.</MissionDesc>
								</MissionCard>
								<MissionCard $active={optimizations.length > 0}>
									<MissionStatus>{optimizations.length > 0 ? "IN PROGRESS" : "OPTIMIZED"}</MissionStatus>
									<MissionTitle>Tame Complexity</MissionTitle>
									<MissionDesc>{optimizations.length} refactor goals identify.</MissionDesc>
								</MissionCard>
							</MissionGrid>
						</MissionSection>

						{Object.keys(layerScores).length > 0 && (
							<ArchitectureHealthSection>
								<SectionHeader>
									<SectionTitle>Architecture Health</SectionTitle>
								</SectionHeader>
								<LayerList>
									{Object.entries(layerScores).map(([layer, score]) => (
										<LayerItem key={layer}>
											<LayerInfo>
												<LayerName>{layer}</LayerName>
												<LayerScore>{score}%</LayerScore>
											</LayerInfo>
											<LayerProgressBarContainer>
												<LayerProgressBar $health={score} $width={score} />
											</LayerProgressBarContainer>
										</LayerItem>
									))}
								</LayerList>
							</ArchitectureHealthSection>
						)}

						{!loading && report && (
							<DashboardSection>
								<SectionHeader>
									<SectionTitle>Maintenance Outlook</SectionTitle>
									<StatLabel>Industry Metrics</StatLabel>
								</SectionHeader>
								<DashboardGrid>
									<DashboardCard title="Estimated time to resolve all identified technical debt.">
										<DashboardIcon>⏳</DashboardIcon>
										<DashboardValue>{report.totalTechnicalDebt}</DashboardValue>
										<DashboardLabel>Recovery Time</DashboardLabel>
									</DashboardCard>
									<DashboardCard title="Percentage of project following stable structural patterns.">
										<DashboardIcon>🛡️</DashboardIcon>
										<DashboardValue>{report.stabilityScore}%</DashboardValue>
										<DashboardLabel>System Stability</DashboardLabel>
									</DashboardCard>
									<DashboardCard title="Ease of understanding and modifying the existing codebase.">
										<DashboardIcon>🏗️</DashboardIcon>
										<DashboardValue>{report.maintainabilityScore}%</DashboardValue>
										<DashboardLabel>Organization</DashboardLabel>
									</DashboardCard>
								</DashboardGrid>
							</DashboardSection>
						)}

						{report && (
							<SummaryNotice>
								{report.buildHealth > 80
									? "Your project health is excellent. Continue following established patterns for maximum stability."
									: report.buildHealth > 50
										? "The project is stable but starting to show signs of structural fatigue. Consider addressing technical debt soon."
										: "CRITICAL: Significant structural issues detected. Immediate attention to the foundations is recommended to prevent future failures."}
							</SummaryNotice>
						)}

						{report && history.length > 1 && (
							<TrendSection>
								<SectionHeader>
									<SectionTitle>Health Evolution</SectionTitle>
									<StatLabel>Last 20 Scans</StatLabel>
								</SectionHeader>
								<TrendChart>
									{history.map((point) => (
										<TrendBar
											$height={asNumber(point.health)}
											key={point.timestamp}
											title={`${new Date(point.timestamp).toLocaleDateString()}: ${Math.round(point.health)}%`}
										/>
									))}
								</TrendChart>
							</TrendSection>
						)}

						{report && (
							<ActivitySection>
								<SectionHeader>
									<SectionTitle>Recent Fixes</SectionTitle>
									<StatLabel>Repair History</StatLabel>
								</SectionHeader>
								<ActivityList>
									{violations
										.filter((v) => asText(v.message).includes("[MANUAL-FIX]"))
										.slice(0, 3)
										.map((v) => (
											<ActivityItem key={`${v.path}-${v.type}`}>
												<ActivityDot />
												<ActivityText>
													<strong>Repaired:</strong> {asText(v.type)} in{" "}
													<code>{asText(v.path).split("/").pop()}</code>
												</ActivityText>
												<ActivityTime>Just now</ActivityTime>
											</ActivityItem>
										))}
									{violations.length === 0 && (
										<EmptyLog>No recent repairs required. All systems are nominal.</EmptyLog>
									)}
								</ActivityList>
							</ActivitySection>
						)}

						<AuditButton
							$primary
							disabled={loading || status === "starting" || status === "streaming"}
							onClick={triggerAudit}
							style={{ marginTop: "8px" }}>
							{loading ? "Scanning Project..." : "Start New Health Audit"}
						</AuditButton>
					</TabView>
				)}

				{activeTab === "fixes" && (
					<TabView>
						<SectionHeader>
							<SectionTitle>Essential Repairs</SectionTitle>
							<Badge $type="LOW">MANUAL REPAIR REQUIRED</Badge>
						</SectionHeader>
						<FilterGroup>
							{["ALL", "STABILITY", "SECURITY", "MAINTAINABILITY"].map((cat) => (
								<FilterBadge
									$active={selectedCategory === (cat === "ALL" ? null : cat)}
									key={cat}
									onClick={() => setSelectedCategory(cat === "ALL" ? null : cat)}>
									{cat}
								</FilterBadge>
							))}
						</FilterGroup>
						<SearchInput
							onChange={(e) => setFixesSearch(e.target.value)}
							placeholder="Filter fixes by path or type..."
							value={fixesSearch}
						/>
						{violations.length === 0 && !loading && (
							<EmptyState>No critical issues detected. Your codebase foundations are strong.</EmptyState>
						)}
						<List>
							{violations
								?.filter(
									(v) =>
										(!selectedCategory || v.impactArea === selectedCategory) &&
										(lower(v.path).includes(fixesSearch.toLowerCase()) ||
											lower(v.type).includes(fixesSearch.toLowerCase()) ||
											lower(v.message).includes(fixesSearch.toLowerCase())),
								)
								.map((v, i) => (
									<ListItem $type="VIOLATION" key={`${v.path}-${i}`}>
										<ListItemContent>
											<BadgeGroup>
												<Badge $type={v.riskLevel || "HIGH"}>{v.riskLevel || "HIGH"} RISK</Badge>
												<Badge $type="CATEGORY">{v.impactArea || "STABILITY"}</Badge>
											</BadgeGroup>
											<ListItemTitle>
												{v.type}
												<PatternLabel title="Violates core architectural principles for long-term maintainability.">
													Structural Anti-Pattern
												</PatternLabel>
											</ListItemTitle>
											<ListItemDesc>{v.message}</ListItemDesc>
											<ListItemRemediation>Repair Strategy: {v.remediation}</ListItemRemediation>
											<ListItemPath>{v.path}</ListItemPath>
										</ListItemContent>
										<ActionGroup>
											<ActionButton
												disabled={launchingTaskId === `FIX_STRUCTURAL_VIOLATION:${v.path}`}
												onClick={() => executeRefactor("FIX_STRUCTURAL_VIOLATION", v.path)}>
												{launchingTaskId === `FIX_STRUCTURAL_VIOLATION:${v.path}`
													? "Fixing..."
													: "Apply Resolution"}
											</ActionButton>
										</ActionGroup>
									</ListItem>
								))}
						</List>
					</TabView>
				)}

				{activeTab === "improvements" && (
					<TabView>
						<SectionTitle style={{ marginBottom: "8px" }}>Priority Matrix (ROI)</SectionTitle>
						<MatrixContainer>
							<MatrixQuadrant $type="WIN">
								<MatrixLabel>QUICK WINS</MatrixLabel>
								<MatrixDesc>Low Effort, High Impact</MatrixDesc>
							</MatrixQuadrant>
							<MatrixQuadrant $type="STRATEGIC">
								<MatrixLabel>STRATEGIC</MatrixLabel>
								<MatrixDesc>High Effort, High Impact</MatrixDesc>
							</MatrixQuadrant>
							<MatrixQuadrant $type="MINIMAL">
								<MatrixLabel>MINIMAL</MatrixLabel>
								<MatrixDesc>Low Effort, Low Impact</MatrixDesc>
							</MatrixQuadrant>
							<MatrixQuadrant $type="DEBT">
								<MatrixLabel>FILLERS</MatrixLabel>
								<MatrixDesc>High Effort, Low Impact</MatrixDesc>
							</MatrixQuadrant>
							{/* Points on the matrix */}
							{optimizations.slice(0, 8).map((opt) => (
								<MatrixPoint
									$effort={opt.effort === "HIGH" ? 75 : opt.effort === "MEDIUM" ? 50 : 25}
									$impact={opt.impact === "HIGH" ? 75 : opt.impact === "MEDIUM" ? 50 : 25}
									key={opt.title}
									title={`${opt.title} (${opt.impact} Impact, ${opt.effort} Effort)`}
								/>
							))}
						</MatrixContainer>

						<SectionTitle style={{ marginBottom: "8px" }}>Maintainability Roadmap</SectionTitle>
						<FilterGroup>
							{["ALL", "STABILITY", "PERFORMANCE", "MAINTAINABILITY"].map((cat) => (
								<FilterBadge
									$active={selectedCategory === (cat === "ALL" ? null : cat)}
									key={cat}
									onClick={() => setSelectedCategory(cat === "ALL" ? null : cat)}>
									{cat}
								</FilterBadge>
							))}
						</FilterGroup>
						<SearchInput
							onChange={(e) => setOptsSearch(e.target.value)}
							placeholder="Filter optimizations..."
							value={optsSearch}
						/>
						{optimizations.length === 0 && !loading && (
							<EmptyState>
								No optimization opportunities identified. Your code is currently lean and focused.
							</EmptyState>
						)}
						<List>
							{optimizations
								?.filter(
									(opt) =>
										(!selectedCategory || opt.category === selectedCategory) &&
										(lower(opt.title).includes(optsSearch.toLowerCase()) ||
											lower(opt.path).includes(optsSearch.toLowerCase()) ||
											lower(opt.description).includes(optsSearch.toLowerCase())),
								)
								.map((opt, i) => (
									<ListItem
										key={`${opt.path}-${i}`}
										onClick={() => toggleOptimizationSelection(i)}
										style={{
											cursor: "pointer",
											border: selectedOptimizations.has(i)
												? "1px solid var(--vscode-button-background)"
												: "1px solid transparent",
										}}>
										<ListItemContent>
											<BadgeGroup>
												{selectedOptimizations.has(i) && <Badge $type="HIGH">SELECTED</Badge>}
												<Badge $type={opt.impact}>{opt.impact} IMPACT</Badge>
												<Badge $type="EFFORT">{opt.effort} EFFORT</Badge>
												<Badge $type="CATEGORY">{opt.category}</Badge>
											</BadgeGroup>
											<ListItemTitle>{opt.title}</ListItemTitle>
											<ListItemDesc>{opt.description}</ListItemDesc>
											<ListItemPath>{opt.path}</ListItemPath>
											{opt.projectedHealthGain > 0 && (
												<HealthGain>Expected Health Boost: +{fixed(opt.projectedHealthGain)}%</HealthGain>
											)}
										</ListItemContent>
										<ActionGroup onClick={(e) => e.stopPropagation()}>
											<SecondaryButton onClick={() => executeRefactor(opt.action, opt.path, true)}>
												View Plan
											</SecondaryButton>
											<ActionButton
												disabled={launchingTaskId === `${opt.action}:${opt.path}`}
												onClick={() => executeRefactor(opt.action, opt.path)}>
												{launchingTaskId === `${opt.action}:${opt.path}`
													? "Applying..."
													: "Apply Optimization"}
											</ActionButton>
										</ActionGroup>
									</ListItem>
								))}
						</List>

						{selectedOptimizations.size > 0 && (
							<BulkRefactorBar>
								<div style={{ fontSize: "12px", fontWeight: "bold" }}>
									{selectedOptimizations.size} optimizations selected
								</div>
								<div style={{ display: "flex", gap: "8px" }}>
									<SecondaryButton onClick={() => setSelectedOptimizations(new Set())}>Clear</SecondaryButton>
									<ActionButton onClick={handleBatchRefactor}>Execute Industrial Batch</ActionButton>
								</div>
							</BulkRefactorBar>
						)}
					</TabView>
				)}

				{loading && progress && (
					<LoadingOverlay>
						<RadarRing $loading={true} $percentage={progressPercentage} />
						<ProgressText>Forensic Scan: {progressCurrentFile.split("/").pop()}</ProgressText>
						<ProgressBarContainer style={{ width: "160px", marginTop: "16px" }}>
							<ProgressBar $width={progressPercentage} />
						</ProgressBarContainer>
					</LoadingOverlay>
				)}

				{auditLaunchMessage && <SuccessNotice>{auditLaunchMessage}</SuccessNotice>}
				{auditLaunchError && <ErrorNotice>{auditLaunchError}</ErrorNotice>}

				{previewPlan && (
					<PreviewModal>
						<PreviewContent>
							<PreviewTitle>Improvement Strategy</PreviewTitle>
							<PreviewText>{previewPlan}</PreviewText>
							<PreviewActions>
								<SecondaryButton onClick={() => setPreviewPlan(null)}>Dismiss</SecondaryButton>
							</PreviewActions>
						</PreviewContent>
					</PreviewModal>
				)}
			</Content>
		</Container>
	)
}

const rotate = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

const Container = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  background: var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
`

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const HeroSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.01) 100%);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.06);
`

const HeaderStats = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`

const QualityGate = styled.div<{ $status: string }>`
  font-size: 9px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 20px;
  letter-spacing: 1px;
  background: ${(props) => (props.$status === "PASSED" ? "rgba(82, 196, 26, 0.2)" : "rgba(255, 77, 79, 0.2)")};
  color: ${(props) => (props.$status === "PASSED" ? "#52c41a" : "#ff4d4f")};
  border: 1px solid ${(props) => (props.$status === "PASSED" ? "rgba(82, 196, 26, 0.3)" : "rgba(255, 77, 79, 0.3)")};
`

const GovernanceGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
`

const GovernanceCard = styled.div<{ $toxic?: boolean }>`
  padding: 14px;
  background: ${(props) => (props.$toxic ? "rgba(255, 77, 79, 0.03)" : "rgba(255, 255, 255, 0.02)")};
  border: 1px solid ${(props) => (props.$toxic ? "rgba(255, 77, 79, 0.2)" : "rgba(255, 255, 255, 0.04)")};
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
`

const GovernanceTitle = styled.div`
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1px;
  opacity: 0.5;
  font-weight: 700;
`

const GovernanceValue = styled.div`
  font-size: 20px;
  font-weight: 800;
  color: var(--vscode-foreground);
`

const GovernanceDesc = styled.div`
  font-size: 9px;
  opacity: 0.4;
  font-weight: 600;
`

const MissionSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const QuickWinsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`

const QuickWinsGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const QuickWinCard = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    background: rgba(24, 144, 255, 0.05);
    border-color: rgba(24, 144, 255, 0.2);
    transform: translateX(4px);
  }
`

const QuickWinIcon = styled.div`
  font-size: 16px;
  filter: drop-shadow(0 0 4px rgba(24, 144, 255, 0.5));
`

const QuickWinContent = styled.div`
  display: flex;
  flex-direction: column;
`

const QuickWinTitle = styled.div`
  font-size: 11px;
  font-weight: 700;
  opacity: 0.9;
`

const QuickWinGain = styled.div`
  font-size: 9px;
  color: #52c41a;
  font-weight: 800;
  letter-spacing: 0.3px;
`

const ArchitectureHealthSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 16px;
`

const LayerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const LayerItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const LayerInfo = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const LayerName = styled.div`
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 800;
  opacity: 0.5;
  letter-spacing: 1px;
`

const LayerScore = styled.div`
  font-size: 10px;
  font-weight: 800;
  opacity: 0.8;
`

const LayerProgressBarContainer = styled.div`
  height: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
  overflow: hidden;
`

const LayerProgressBar = styled.div<{ $width: number; $health: number }>`
  height: 100%;
  width: ${(props) => props.$width}%;
  background: ${(props) => (props.$health > 80 ? "#52c41a" : props.$health > 50 ? "#faad14" : "#ff4d4f")};
  box-shadow: 0 0 8px ${(props) => (props.$health > 80 ? "rgba(82, 196, 26, 0.3)" : "rgba(255, 77, 79, 0.3)")};
  transition: width 1s ease-in-out;
`

const MissionGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`

const MissionCard = styled.div<{ $active?: boolean }>`
  padding: 12px;
  background: ${(props) => (props.$active ? "rgba(24, 144, 255, 0.05)" : "rgba(255, 255, 255, 0.02)")};
  border: 1px solid ${(props) => (props.$active ? "rgba(24, 144, 255, 0.2)" : "rgba(255, 255, 255, 0.05)")};
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const MissionStatus = styled.div`
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1px;
  opacity: 0.6;
`

const MissionTitle = styled.div`
  font-size: 11px;
  font-weight: 700;
`

const MissionDesc = styled.div`
  font-size: 9px;
  opacity: 0.5;
  line-height: 1.3;
`

const SummaryNotice = styled.div`
  font-size: 11px;
  line-height: 1.5;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border-left: 2px solid var(--vscode-button-background);
  border-radius: 4px;
  opacity: 0.9;
`

const ActivitySection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 12px;
`

const ActivityList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ActivityItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  position: relative;
  padding-left: 12px;
`

const ActivityDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1890ff;
  margin-top: 5px;
  box-shadow: 0 0 6px rgba(24, 144, 255, 0.5);
  flex-shrink: 0;
`

const ActivityText = styled.div`
  font-size: 10px;
  opacity: 0.8;
  line-height: 1.4;
  
  code {
    background: rgba(255, 255, 255, 0.05);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family);
  }
`

const ActivityTime = styled.div`
  font-size: 8px;
  opacity: 0.3;
  margin-left: auto;
  white-space: nowrap;
`

const StatLabel = styled.div`
  font-size: 9px;
  text-transform: uppercase;
  opacity: 0.4;
  font-weight: 700;
`

const EmptyLog = styled.div`
  font-size: 10px;
  opacity: 0.4;
  text-align: center;
  padding: 8px;
  font-style: italic;
`

const TabContainer = styled.div`
  display: flex;
  background: rgba(0, 0, 0, 0.15);
  padding: 3px;
  border-radius: 10px;
  gap: 2px;
`

const Tab = styled.div<{ $active: boolean }>`
  flex: 1;
  text-align: center;
  padding: 6px 2px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: ${(props) => (props.$active ? "rgba(255, 255, 255, 0.08)" : "transparent")};
  color: ${(props) => (props.$active ? "var(--vscode-foreground)" : "rgba(255, 255, 255, 0.4)")};
`

const TabView = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: ${keyframes`from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); }`} 0.3s ease;
`

const SubstrateStatus = styled.div<{ $health: number }>`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 2px;
  color: ${(props) => (props.$health > 80 ? "#52c41a" : "#faad14")};
  background: ${(props) => (props.$health > 80 ? "rgba(82, 196, 26, 0.1)" : "rgba(250, 173, 20, 0.1)")};
  padding: 4px 12px;
  border-radius: 20px;
`

const DashboardSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const DashboardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  width: 100%;
`

const DashboardCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 4px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.04);
`

const DashboardIcon = styled.div`
  font-size: 16px;
  margin-bottom: 4px;
`

const DashboardValue = styled.div`
  font-size: 14px;
  font-weight: 700;
`

const DashboardLabel = styled.div`
  font-size: 9px;
  text-transform: uppercase;
  opacity: 0.4;
  letter-spacing: 0.5px;
`

const TrendSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const TrendChart = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 40px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 8px;
`

const TrendBar = styled.div<{ $height: number }>`
  flex: 1;
  height: ${(props) => props.$height}%;
  background: var(--vscode-button-background);
  opacity: 0.6;
  border-radius: 2px 2px 0 0;
  min-width: 4px;
  transition: all 0.3s ease;
  
  &:hover {
    opacity: 1;
    background: #40a9ff;
  }
`

const RadarContainer = styled.div`
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`

const RadarRing = styled.div<{ $loading: boolean; $percentage: number }>`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border: 3px solid var(--vscode-button-background);
  border-top-color: transparent;
  border-radius: 50%;
  animation: ${(props) => (props.$loading ? rotate : "none")} 2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  opacity: ${(props) => (props.$loading ? 0.8 : 0.2)};
`

const GradeValue = styled.div<{ $grade: string }>`
  font-size: 60px;
  font-weight: 800;
  line-height: 1;
  color: ${(props) => {
		if (props.$grade === "A") return "#52c41a"
		if (props.$grade === "B") return "#b7eb8f"
		if (props.$grade === "C") return "#faad14"
		if (props.$grade === "D") return "#ff7875"
		return "#ff4d4f"
  }};
`

const HealthLabel = styled.div`
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  opacity: 0.5;
  font-weight: 700;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
`

const DeltaBadge = styled.div<{ $positive: boolean }>`
  font-size: 8px;
  background: ${(props) => (props.$positive ? "rgba(82, 196, 26, 0.15)" : "rgba(255, 77, 79, 0.15)")};
  color: ${(props) => (props.$positive ? "#52c41a" : "#ff4d4f")};
  padding: 1px 4px;
  border-radius: 4px;
  font-weight: 800;
`

const DeltaInline = styled.span<{ $positive: boolean }>`
  font-size: 9px;
  margin-left: 4px;
  color: ${(props) => (props.$positive ? "#52c41a" : "#ff4d4f")};
  font-weight: 800;
`

const RiskProfileSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.04);
`

const RiskBar = styled.div`
  height: 8px;
  display: flex;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
`

const RiskSegment = styled.div<{ $type: string; $width: number; $total: number }>`
  height: 100%;
  width: ${(props) => (props.$width / (props.$total || 1)) * 100}%;
  background: ${(props) => (props.$type === "HIGH" ? "#ff4d4f" : props.$type === "MEDIUM" ? "#faad14" : "#52c41a")};
  transition: width 1s ease-in-out;
  border-right: 1px solid rgba(0, 0, 0, 0.2);
  
  &:last-child { border-right: none; }
`

const RiskLegend = styled.div`
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 4px;
`

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  font-weight: 700;
  opacity: 0.6;
`

const Dot = styled.div<{ $type: string }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${(props) => (props.$type === "HIGH" ? "#ff4d4f" : props.$type === "MEDIUM" ? "#faad14" : "#52c41a")};
`

const BadgeGroup = styled.div`
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
`

const Badge = styled.div<{ $type: string }>`
  font-size: 8px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.5px;
  
  ${(props) => {
		if (props.$type === "HIGH") return "background: rgba(82, 196, 26, 0.2); color: #52c41a;"
		if (props.$type === "MEDIUM") return "background: rgba(250, 173, 20, 0.2); color: #faad14;"
		if (props.$type === "LOW") return "background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.6);"
		if (props.$type === "AUTO") return "background: rgba(24, 144, 255, 0.2); color: #1890ff;"
		if (props.$type === "CATEGORY") return "background: rgba(114, 46, 209, 0.15); color: #b37feb;"
		return "background: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.5);"
  }}
`

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  backdrop-filter: blur(4px);
`

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const SectionTitle = styled.h3`
  font-size: 13px;
  font-weight: 800;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 1px;
  opacity: 0.8;
`

const AuditButton = styled.button<{ $primary?: boolean }>`
  background: ${(props) => (props.$primary ? "var(--vscode-button-background)" : "rgba(255, 255, 255, 0.05)")};
  color: ${(props) => (props.$primary ? "var(--vscode-button-foreground)" : "var(--vscode-foreground)")};
  border: none;
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 800;
  width: 100%;
  transition: all 0.2s ease;
  &:hover { opacity: 0.9; transform: translateY(-1px); }
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const ListItem = styled.div<{ $type?: string }>`
  background: rgba(255, 255, 255, 0.02);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.04);
`

const ListItemContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ListItemTitle = styled.div`
  font-weight: 800;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const ListItemDesc = styled.div`
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.7;
`

const ListItemPath = styled.div`
  font-size: 10px;
  font-family: var(--vscode-editor-font-family);
  opacity: 0.4;
  background: rgba(0, 0, 0, 0.2);
  padding: 3px 8px;
  border-radius: 6px;
  align-self: flex-start;
`

const ListItemRemediation = styled.div`
  font-size: 11px;
  color: #faad14;
  font-weight: 700;
  background: rgba(250, 173, 20, 0.05);
  padding: 8px;
  border-radius: 8px;
`

const HealthGain = styled.div`
  font-size: 10px;
  color: #52c41a;
  font-weight: 800;
  letter-spacing: 0.5px;
`

const ActionGroup = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 4px;
`

const ActionButton = styled.button`
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 800;
  flex: 2;
`

const SecondaryButton = styled.button`
  background: rgba(255, 255, 255, 0.05);
  color: var(--vscode-foreground);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
  flex: 1;
`

const HealthSnapshot = styled.div<{ $health: number }>`
  padding: 16px;
  background: ${(props) => (props.$health > 80 ? "rgba(82, 196, 26, 0.05)" : props.$health > 50 ? "rgba(250, 173, 20, 0.05)" : "rgba(255, 77, 79, 0.05)")};
  border: 1px solid ${(props) => (props.$health > 80 ? "rgba(82, 196, 26, 0.2)" : props.$health > 50 ? "rgba(250, 173, 20, 0.2)" : "rgba(255, 77, 79, 0.2)")};
  border-radius: 16px;
  display: flex;
  gap: 16px;
  align-items: center;
`

const SnapshotIcon = styled.div`
  font-size: 24px;
`

const SnapshotContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const SnapshotTitle = styled.div`
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const SnapshotDesc = styled.div`
  font-size: 11px;
  opacity: 0.7;
  line-height: 1.4;
`

const ScanningNotice = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: rgba(24, 144, 255, 0.05);
  border-radius: 12px;
  border: 1px solid rgba(24, 144, 255, 0.1);
`

const ScanningIcon = styled.div`
  font-size: 16px;
  animation: ${rotate} 2s linear infinite;
`

const ScanningText = styled.div`
  font-size: 11px;
  font-weight: 600;
  opacity: 0.8;
`

const EmptyState = styled.div`
  padding: 40px 20px;
  text-align: center;
  opacity: 0.4;
  font-size: 12px;
  border: 1px dashed rgba(255, 255, 255, 0.1);
  border-radius: 16px;
`

const SuccessNotice = styled.div`
  padding: 10px;
  border-radius: 10px;
  background: rgba(82, 196, 26, 0.1);
  color: #52c41a;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
`

const ErrorNotice = styled.div`
  padding: 10px;
  border-radius: 10px;
  background: rgba(255, 77, 79, 0.1);
  color: #ff4d4f;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
`

const PreviewModal = styled.div`
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
  padding: 20px;
  backdrop-filter: blur(10px);
`

const PreviewContent = styled.div`
  background: var(--vscode-sideBar-background);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 24px;
  max-width: 500px;
  width: 100%;
`

const PreviewTitle = styled.h2`
  font-size: 16px;
  margin: 0 0 16px 0;
`

const PreviewText = styled.div`
  font-size: 12px;
  line-height: 1.6;
  opacity: 0.8;
  background: rgba(0,0,0,0.3);
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 20px;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
`

const PreviewActions = styled.div`
  display: flex;
  justify-content: flex-end;
`

const BulkRefactorBar = styled.div`
  position: sticky;
  bottom: 0;
  background: var(--vscode-sideBar-background);
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 100;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.2);
  border-radius: 0 0 16px 16px;
`

const FilterGroup = styled.div`
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
`

const FilterBadge = styled.div<{ $active: boolean }>`
  font-size: 9px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  background: ${(props) => (props.$active ? "var(--vscode-button-background)" : "rgba(255, 255, 255, 0.05)")};
  color: ${(props) => (props.$active ? "var(--vscode-button-foreground)" : "rgba(255, 255, 255, 0.4)")};
  border: 1px solid ${(props) => (props.$active ? "transparent" : "rgba(255, 255, 255, 0.1)")};
  
  &:hover {
    background: ${(props) => (props.$active ? "var(--vscode-button-background)" : "rgba(255, 255, 255, 0.1)")};
  }
`

const SearchInput = styled.input`
  width: 100%;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--vscode-foreground);
  font-size: 11px;
  margin-bottom: 8px;
  
  &:focus {
    outline: none;
    border-color: var(--vscode-button-background);
  }
  
  &::placeholder {
    opacity: 0.4;
  }
`

const SnapshotTitleGroup = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`

const TrendSparkline = styled.div`
  background: rgba(0, 0, 0, 0.1);
  padding: 2px 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
`

const PatternLabel = styled.span`
  font-size: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.4);
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 8px;
  font-weight: 400;
  cursor: help;
  border: 1px solid rgba(255, 255, 255, 0.05);
`

const MatrixContainer = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  width: 100%;
  height: 180px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.05);
`

const MatrixQuadrant = styled.div<{ $type: string }>`
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.03);
  
  ${(props) => {
		if (props.$type === "WIN") return "background: rgba(82, 196, 26, 0.02);"
		if (props.$type === "STRATEGIC") return "background: rgba(24, 144, 255, 0.02);"
		if (props.$type === "MINIMAL") return "background: rgba(255, 255, 255, 0.01);"
		return "background: rgba(255, 77, 79, 0.01);"
  }}
`

const MatrixLabel = styled.div`
  font-size: 9px;
  font-weight: 800;
  opacity: 0.5;
  letter-spacing: 1px;
`

const MatrixDesc = styled.div`
  font-size: 7px;
  opacity: 0.3;
  text-transform: uppercase;
  margin-top: 2px;
`

const MatrixPoint = styled.div<{ $effort: number; $impact: number }>`
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vscode-button-background);
  box-shadow: 0 0 8px var(--vscode-button-background);
  bottom: ${(props) => props.$impact}%;
  left: ${(props) => props.$effort}%;
  transform: translate(-50%, 50%);
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 10;
  
  &:hover {
    width: 12px;
    height: 12px;
    box-shadow: 0 0 12px #fff;
  }
`

const ShareButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: var(--vscode-foreground);
  font-size: 9px;
  font-weight: 700;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  
  span {
    font-size: 10px;
  }
`

const WelcomeView = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  gap: 20px;
  flex: 1;
`

const WelcomeIcon = styled.div`
  font-size: 64px;
  filter: drop-shadow(0 0 20px rgba(24, 144, 255, 0.3));
`

const WelcomeTitle = styled.h2`
  font-size: 20px;
  font-weight: 800;
  margin: 0;
`

const WelcomeDesc = styled.p`
  font-size: 13px;
  opacity: 0.6;
  max-width: 400px;
  line-height: 1.6;
  margin: 0;
`

const RadarChartSection = styled.div`
  padding: 20px;
  display: flex;
  justify-content: center;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 20px;
`

const RadarChartWrapper = styled.div`
  position: relative;
  width: 180px;
  height: 180px;
`

const RadarLabel = styled.div`
  position: absolute;
  font-size: 8px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.4;
  white-space: nowrap;
`

const ChecklistSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Checklist = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.1);
  padding: 12px;
  border-radius: 12px;
`

const CheckItem = styled.div<{ $passed: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  opacity: ${(props) => (props.$passed ? 1 : 0.6)};
`

const CheckIcon = styled.div`
  font-size: 14px;
`

const CheckText = styled.div`
  font-size: 11px;
  font-weight: 600;
`

const NextActionCard = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
`

const NextActionIcon = styled.div`
  font-size: 20px;
`

const NextActionContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const NextActionTitle = styled.div`
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const NextActionDesc = styled.div`
  font-size: 11px;
  opacity: 0.9;
  line-height: 1.4;
`

const NextActionArrow = styled.div`
  font-size: 18px;
  font-weight: 800;
`

const DriftWarning = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(250, 173, 20, 0.1);
  border-radius: 10px;
  border: 1px solid rgba(250, 173, 20, 0.2);
`

const WarningIcon = styled.div`
  font-size: 14px;
`

const WarningText = styled.div`
  font-size: 10px;
  color: #faad14;
  font-weight: 700;
`

const ProgressBarContainer = styled.div`
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
`

const ProgressBar = styled.div<{ $width: number }>`
  height: 100%;
  width: ${(props) => props.$width}%;
  background: var(--vscode-button-background);
`

const ProgressText = styled.div`
  font-size: 11px;
  font-weight: 500;
  opacity: 0.9;
  font-family: var(--vscode-editor-font-family);
`

export default JoyZoningView
