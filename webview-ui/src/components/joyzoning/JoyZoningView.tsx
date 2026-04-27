import { JoyZoningAuditProgress, JoyZoningAuditResponse } from "@shared/proto/dietcode/joyzoning"
import { useCallback, useEffect, useRef, useState } from "react"
import styled, { keyframes } from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { JoyZoningServiceClient } from "@/services/grpc-client"
import ViewHeader from "../common/ViewHeader"

const JoyZoningView = ({ onDone }: { onDone: () => void }) => {
	const { environment } = useExtensionState()
	const [loading, setLoading] = useState(false)
	const [report, setReport] = useState<JoyZoningAuditResponse | null>(null)
	const [progress, setProgress] = useState<JoyZoningAuditProgress | null>(null)
	const [previewPlan, setPreviewPlan] = useState<string | null>(null)

	const [status, setStatus] = useState<"idle" | "starting" | "streaming" | "completed" | "error" | "cancelled">("idle")
	const [launchingTaskId, setLaunchingTaskId] = useState<string | null>(null)
	const [auditLaunchMessage, setAuditLaunchMessage] = useState<string | null>(null)
	const [auditLaunchError, setAuditLaunchError] = useState<string | null>(null)
	const [activeTab, setActiveTab] = useState<"overview" | "fixes" | "improvements">("overview")

	const cancelRef = useRef<(() => void) | null>(null)
	const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

	const cleanupTimers = useCallback(() => {
		for (const timer of timersRef.current) {
			clearTimeout(timer)
		}
		timersRef.current = []
	}, [])

	useEffect(() => {
		return () => {
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

	return (
		<Container>
			<ViewHeader environment={environment} onDone={onDone} title="JoyZoning Substrate" />
			<Content>
				<HeroSection>
					{report?.driftDetected && (
						<DriftWarning>
							<WarningIcon>⚠️</WarningIcon>
							<WarningText>Substrate Drift: {report.driftCount} files out of sync.</WarningText>
						</DriftWarning>
					)}
					<RadarContainer>
						<RadarRing $loading={loading} $percentage={progress?.percentage || 0} />
						<GradeValue $grade={report?.grade || "A"}>{report ? report.grade : loading ? "..." : "--"}</GradeValue>
						<HealthLabel>
							{loading ? "Scanning..." : "Build Grade"}
							{report && report.healthDelta !== 0 && (
								<DeltaBadge $positive={report.healthDelta > 0}>
									{report.healthDelta > 0 ? "+" : ""}
									{report.healthDelta.toFixed(1)}%
								</DeltaBadge>
							)}
						</HealthLabel>
					</RadarContainer>

					<HeaderStats>
						<SubstrateStatus $health={report?.buildHealth || 100}>
							{loading ? "ANALYZING..." : (report?.buildHealth || 100) > 80 ? "● OPERATIONAL" : "● ACTION REQUIRED"}
						</SubstrateStatus>
						{report && <QualityGate $status={report.qualityGateStatus}>{report.qualityGateStatus}</QualityGate>}
					</HeaderStats>
				</HeroSection>

				<TabContainer>
					<Tab $active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
						Overview
					</Tab>
					<Tab $active={activeTab === "fixes"} onClick={() => setActiveTab("fixes")}>
						Fixes{" "}
						{report?.violations && report.violations.length > 0 ? (
							<>
								({report.violations.length})
								{report.violationDelta !== 0 && (
									<DeltaInline $positive={report.violationDelta < 0}>
										{report.violationDelta > 0 ? "+" : ""}
										{report.violationDelta}
									</DeltaInline>
								)}
							</>
						) : (
							""
						)}
					</Tab>
					<Tab $active={activeTab === "improvements"} onClick={() => setActiveTab("improvements")}>
						Roadmap{" "}
						{report?.optimizations && report.optimizations.length > 0 ? `(${report.optimizations.length})` : ""}
					</Tab>
				</TabContainer>

				{activeTab === "overview" && (
					<TabView>
						<GovernanceGrid>
							<GovernanceCard>
								<GovernanceTitle>Compliance Posture</GovernanceTitle>
								<GovernanceValue>{report?.complianceScore || 0}%</GovernanceValue>
								<GovernanceDesc>Adherence to Axioms</GovernanceDesc>
							</GovernanceCard>
							<GovernanceCard $toxic={!!report?.toxicModule}>
								<GovernanceTitle>Toxic Module</GovernanceTitle>
								<GovernanceValue style={{ fontSize: "11px", opacity: 0.9 }}>
									{report?.toxicModule || "None"}
								</GovernanceValue>
								<GovernanceDesc>Focus Area</GovernanceDesc>
							</GovernanceCard>
						</GovernanceGrid>

						{report?.riskProfile && (
							<RiskProfileSection>
								<SectionHeader>
									<SectionTitle>Substrate Risk Profile</SectionTitle>
									<StatLabel>File Distribution</StatLabel>
								</SectionHeader>
								<RiskBar>
									<RiskSegment
										$total={report.totalFiles}
										$type="LOW"
										$width={report.riskProfile.LOW || 0}
										title="Low Risk"
									/>
									<RiskSegment
										$total={report.totalFiles}
										$type="MEDIUM"
										$width={report.riskProfile.MEDIUM || 0}
										title="Medium Risk"
									/>
									<RiskSegment
										$total={report.totalFiles}
										$type="HIGH"
										$width={report.riskProfile.HIGH || 0}
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

						{report?.topRecommendations && report.topRecommendations.length > 0 && (
							<QuickWinsSection>
								<SectionHeader>
									<SectionTitle>Top Recommendations</SectionTitle>
									<Badge $type="HIGH">QUICK WINS</Badge>
								</SectionHeader>
								<QuickWinsGrid>
									{report.topRecommendations.map((opt) => (
										<QuickWinCard key={opt.title} onClick={() => setActiveTab("improvements")}>
											<QuickWinIcon>⚡</QuickWinIcon>
											<QuickWinContent>
												<QuickWinTitle>{opt.title}</QuickWinTitle>
												<QuickWinGain>+{opt.projectedHealthGain.toFixed(1)}% Health Boost</QuickWinGain>
											</QuickWinContent>
										</QuickWinCard>
									))}
								</QuickWinsGrid>
							</QuickWinsSection>
						)}

						<MissionSection>
							<SectionHeader>
								<SectionTitle>Guided Missions</SectionTitle>
							</SectionHeader>
							<MissionGrid>
								<MissionCard $active={(report?.violations?.length ?? 0) > 0}>
									<MissionStatus>
										{(report?.violations?.length ?? 0) > 0 ? "ACTION REQUIRED" : "STABLE"}
									</MissionStatus>
									<MissionTitle>Harden Foundations</MissionTitle>
									<MissionDesc>Fix {report?.violations?.length || 0} structural risks.</MissionDesc>
								</MissionCard>
								<MissionCard $active={(report?.optimizations?.length ?? 0) > 0}>
									<MissionStatus>
										{(report?.optimizations?.length ?? 0) > 0 ? "IN PROGRESS" : "OPTIMIZED"}
									</MissionStatus>
									<MissionTitle>Tame Complexity</MissionTitle>
									<MissionDesc>{report?.optimizations?.length || 0} refactor goals identify.</MissionDesc>
								</MissionCard>
							</MissionGrid>
						</MissionSection>

						{report?.layerScores && Object.keys(report.layerScores).length > 0 && (
							<ArchitectureHealthSection>
								<SectionHeader>
									<SectionTitle>Architecture Health</SectionTitle>
								</SectionHeader>
								<LayerList>
									{Object.entries(report.layerScores).map(([layer, score]) => (
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
							<DashboardGrid>
								<DashboardCard>
									<DashboardIcon>⏳</DashboardIcon>
									<DashboardValue>{report.totalTechnicalDebt}</DashboardValue>
									<DashboardLabel>Tech Debt</DashboardLabel>
								</DashboardCard>
								<DashboardCard>
									<DashboardIcon>🛡️</DashboardIcon>
									<DashboardValue>{report.stabilityScore}%</DashboardValue>
									<DashboardLabel>Stability Index</DashboardLabel>
								</DashboardCard>
								<DashboardCard>
									<DashboardIcon>🏗️</DashboardIcon>
									<DashboardValue>{report.maintainabilityScore}%</DashboardValue>
									<DashboardLabel>Maintainability</DashboardLabel>
								</DashboardCard>
							</DashboardGrid>
						)}

						{report && (
							<SummaryNotice>
								{report.buildHealth > 80
									? "Your substrate is in excellent condition. Focus on minor maintainability optimizations."
									: report.buildHealth > 50
										? "The project is stable but has accumulated noticeable technical debt. Consider a hardening sprint."
										: "CRITICAL: Multiple structural risks detected. Foundation hardening is highly recommended."}
							</SummaryNotice>
						)}

						{report && report.history.length > 1 && (
							<TrendSection>
								<SectionHeader>
									<SectionTitle>Health Evolution</SectionTitle>
									<StatLabel>Last 20 Scans</StatLabel>
								</SectionHeader>
								<TrendChart>
									{report.history.map((point) => (
										<TrendBar
											$height={point.health}
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
									<SectionTitle>Recent Activity</SectionTitle>
									<StatLabel>Auto-Healing Log</StatLabel>
								</SectionHeader>
								<ActivityList>
									{report.violations
										.filter((v) => v.message.includes("[AUTO-FIX]"))
										.slice(0, 3)
										.map((v) => (
											<ActivityItem key={`${v.path}-${v.type}`}>
												<ActivityDot />
												<ActivityText>
													<strong>Auto-Healing:</strong> {v.type} in{" "}
													<code>{v.path.split("/").pop()}</code>
												</ActivityText>
												<ActivityTime>Just now</ActivityTime>
											</ActivityItem>
										))}
									{report.violations.length === 0 && (
										<EmptyLog>No recent healing actions required. Substrate is nominal.</EmptyLog>
									)}
								</ActivityList>
							</ActivitySection>
						)}

						<AuditButton
							$primary
							disabled={loading || status === "starting" || status === "streaming"}
							onClick={triggerAudit}
							style={{ marginTop: "8px" }}>
							{loading ? "Forensic Scan in Progress..." : "Run New Forensic Audit"}
						</AuditButton>
					</TabView>
				)}

				{activeTab === "fixes" && (
					<TabView>
						<SectionHeader>
							<SectionTitle>Structural Repairs</SectionTitle>
							<Badge $type="AUTO">AUTO-HEALING ACTIVE</Badge>
						</SectionHeader>
						{report?.violations.length === 0 && !loading && (
							<EmptyState>No foundational risks detected. Your substrate is solid.</EmptyState>
						)}
						<List>
							{report?.violations?.map((v, i) => (
								<ListItem $type="VIOLATION" key={`${v.path}-${i}`}>
									<ListItemContent>
										<BadgeGroup>
											<Badge $type={v.riskLevel || "HIGH"}>{v.riskLevel || "HIGH"} RISK</Badge>
											<Badge $type="CATEGORY">{v.impactArea || "STABILITY"}</Badge>
										</BadgeGroup>
										<ListItemTitle>
											{v.type} {v.message.includes("[AUTO-FIX]") && <Badge $type="AUTO">AUTO-FIXING</Badge>}
										</ListItemTitle>
										<ListItemDesc>{v.message}</ListItemDesc>
										<ListItemRemediation>Repair Strategy: {v.remediation}</ListItemRemediation>
										<ListItemPath>{v.path}</ListItemPath>
									</ListItemContent>
								</ListItem>
							))}
						</List>
					</TabView>
				)}

				{activeTab === "improvements" && (
					<TabView>
						<SectionTitle style={{ marginBottom: "8px" }}>Maintainability Roadmap</SectionTitle>
						{report?.optimizations.length === 0 && !loading && (
							<EmptyState>Your components are lean and focused. No roadmap items identified.</EmptyState>
						)}
						<List>
							{report?.optimizations?.map((opt, i) => (
								<ListItem key={`${opt.path}-${i}`}>
									<ListItemContent>
										<BadgeGroup>
											<Badge $type={opt.impact}>{opt.impact} IMPACT</Badge>
											<Badge $type="EFFORT">{opt.effort} EFFORT</Badge>
											<Badge $type="CATEGORY">{opt.category}</Badge>
										</BadgeGroup>
										<ListItemTitle>{opt.title}</ListItemTitle>
										<ListItemDesc>{opt.description}</ListItemDesc>
										<ListItemPath>{opt.path}</ListItemPath>
										{opt.projectedHealthGain > 0 && (
											<HealthGain>Expected Health Boost: +{opt.projectedHealthGain.toFixed(1)}%</HealthGain>
										)}
									</ListItemContent>
									<ActionGroup>
										<SecondaryButton onClick={() => executeRefactor(opt.action, opt.path, true)}>
											View Plan
										</SecondaryButton>
										<ActionButton
											disabled={launchingTaskId === `${opt.action}:${opt.path}`}
											onClick={() => executeRefactor(opt.action, opt.path)}>
											{launchingTaskId === `${opt.action}:${opt.path}`
												? "Repairing..."
												: "Apply Improvement"}
										</ActionButton>
									</ActionGroup>
								</ListItem>
							))}
						</List>
					</TabView>
				)}

				{loading && progress && (
					<LoadingOverlay>
						<RadarRing $loading={true} $percentage={progress.percentage} />
						<ProgressText>Forensic Scan: {progress.currentFile.split("/").pop()}</ProgressText>
						<ProgressBarContainer style={{ width: "160px", marginTop: "16px" }}>
							<ProgressBar $width={progress.percentage} />
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
