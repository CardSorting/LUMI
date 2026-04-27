import { JoyZoningAuditProgress, JoyZoningAuditResponse } from "@shared/proto/dietcode/joyzoning"
import { useCallback, useEffect, useState } from "react"
import styled, { css, keyframes } from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { JoyZoningServiceClient } from "@/services/grpc-client"
import ViewHeader from "../common/ViewHeader"

const JoyZoningView = ({ onDone }: { onDone: () => void }) => {
	const { environment } = useExtensionState()
	const [loading, setLoading] = useState(false)
	const [report, setReport] = useState<JoyZoningAuditResponse | null>(null)
	const [progress, setProgress] = useState<JoyZoningAuditProgress | null>(null)
	const [previewPlan, setPreviewPlan] = useState<string | null>(null)

	const [launchingTaskId, setLaunchingTaskId] = useState<string | null>(null)

	const triggerAudit = useCallback((useCache = false) => {
		setLoading(true)
		if (!useCache) {
			setReport(null)
			setProgress(null)
		}

		JoyZoningServiceClient.triggerAudit(
			{ path: "", useCache },
			{
				onResponse: (response: JoyZoningAuditResponse) => {
					if (response.progress) {
						setProgress(response.progress)
					}
					if (response.violations.length > 0 || response.optimizations.length > 0 || response.buildHealth > 0) {
						setReport(response)
					}
				},
				onError: (error: Error) => {
					console.error("Audit failed:", error)
					setLoading(false)
				},
				onComplete: () => {
					setLoading(false)
				},
			},
		)
	}, [])

	const executeRefactor = async (action: string, path: string, dryRun = false) => {
		try {
			const response = await JoyZoningServiceClient.executeRefactor({ action, path, dryRun })
			if (dryRun) {
				setPreviewPlan(response.planSummary || "No plan summary available.")
			} else if (response.success) {
				setLaunchingTaskId(response.taskId)
				setTimeout(() => setLaunchingTaskId(null), 5000)
			}
		} catch (error) {
			console.error("Refactor failed:", error)
		}
	}

	useEffect(() => {
		// Attempt to restore from cache on mount
		triggerAudit(true)
	}, [triggerAudit])

	return (
		<Container>
			<ViewHeader environment={environment} onDone={onDone} title="JoyZoning Audit" />
			<Content>
				<HeroSection>
					{report?.driftDetected && (
						<DriftWarning>
							<WarningIcon>⚠️</WarningIcon>
							<WarningText>
								Substrate Drift Detected: {report.driftCount} files out of sync. Please re-index.
							</WarningText>
						</DriftWarning>
					)}
					<RadarContainer>
						<RadarRing $loading={loading} $percentage={progress?.percentage || 0} />
						<HealthScore $value={report?.buildHealth || 0}>
							{report ? Math.round(report.buildHealth) : loading ? Math.round(progress?.percentage || 0) : "--"}
						</HealthScore>
						<HealthLabel>{loading ? "Scanning Project..." : "Build Health"}</HealthLabel>
					</RadarContainer>

					{loading && progress && (
						<ProgressInfo>
							<ProgressBarContainer>
								<ProgressBar $width={progress.percentage} />
							</ProgressBarContainer>
							<ProgressText>Indexing: {progress.currentFile.split("/").pop()}</ProgressText>
							<ProgressStats>
								{progress.processedFiles} / {progress.totalFiles} files
							</ProgressStats>
						</ProgressInfo>
					)}

					{!loading && report && (
						<StatsGrid>
							<StatCard>
								<StatValue>{report.totalFiles}</StatValue>
								<StatLabel>Files Scanned</StatLabel>
							</StatCard>
							<StatCard>
								<StatValue>{report.structuralEntropy.toFixed(2)}</StatValue>
								<StatLabel>Structural Entropy</StatLabel>
							</StatCard>
							<StatCard>
								<StatValue>{report.integrityScore.toFixed(0)}%</StatValue>
								<StatLabel>Integrity</StatLabel>
							</StatCard>
							<StatCard $stress={report.metabolicPressure}>
								<StatValue>{(report.metabolicPressure * 100).toFixed(0)}%</StatValue>
								<StatLabel>Metabolic Pressure</StatLabel>
							</StatCard>
							<StatCard>
								<StatValue>{Math.round(report.projectedHealth)}</StatValue>
								<StatLabel>Projected</StatLabel>
							</StatCard>
						</StatsGrid>
					)}
				</HeroSection>

				{previewPlan && (
					<PreviewModal>
						<PreviewContent>
							<PreviewTitle>Refactoring Preview</PreviewTitle>
							<PreviewText>{previewPlan}</PreviewText>
							<PreviewActions>
								<SecondaryButton onClick={() => setPreviewPlan(null)}>Close</SecondaryButton>
							</PreviewActions>
						</PreviewContent>
					</PreviewModal>
				)}

				<Section>
					<SectionHeader>
						<SectionTitle>Optimization Opportunities</SectionTitle>
						<AuditButton disabled={loading} onClick={() => triggerAudit()}>
							{loading ? "Scanning..." : "Re-Scan"}
						</AuditButton>
					</SectionHeader>

					{report?.optimizations.length === 0 && !loading && (
						<EmptyState>No optimization opportunities found. Codebase is well-aligned.</EmptyState>
					)}

					<List>
						{report?.optimizations.map((opt, i) => (
							<ListItem key={`${opt.path}-${i}`}>
								<ListItemContent>
									<ListItemTitle>{opt.title}</ListItemTitle>
									<ListItemDesc>{opt.description}</ListItemDesc>
									<ListItemPath>{opt.path}</ListItemPath>
									{opt.projectedHealthGain > 0 && (
										<HealthGain>+{opt.projectedHealthGain.toFixed(1)} Health Gain</HealthGain>
									)}
								</ListItemContent>
								<ActionGroup>
									<SecondaryButton onClick={() => executeRefactor(opt.action, opt.path, true)}>
										Preview
									</SecondaryButton>
									<ActionButton
										disabled={launchingTaskId !== null}
										onClick={() => executeRefactor(opt.action, opt.path)}>
										{launchingTaskId ? "Launching..." : "Execute"}
									</ActionButton>
								</ActionGroup>
							</ListItem>
						))}
					</List>
				</Section>

				<Section>
					<SectionTitle>Structural Violations</SectionTitle>
					{report?.violations.length === 0 && !loading && (
						<EmptyState>No architectural violations detected.</EmptyState>
					)}
					<List>
						{report?.violations.map((v, i) => (
							<ListItem $type="VIOLATION" key={`${v.path}-${i}`}>
								<ListItemContent>
									<ListItemTitle>{v.type}</ListItemTitle>
									<ListItemDesc>{v.message}</ListItemDesc>
									<ListItemRemediation>Fix: {v.remediation}</ListItemRemediation>
									<ListItemPath>{v.path}</ListItemPath>
								</ListItemContent>
							</ListItem>
						))}
					</List>
				</Section>
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
`

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px;
`

const HeroSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  margin-bottom: 32px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.05);
`

const DriftWarning = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(250, 173, 20, 0.1);
  border: 1px solid rgba(250, 173, 20, 0.3);
  border-radius: 8px;
  margin-bottom: 8px;
  animation: ${keyframes`
    0% { opacity: 0.8; }
    50% { opacity: 1; }
    100% { opacity: 0.8; }
  `} 2s infinite ease-in-out;
`

const WarningIcon = styled.div`
  font-size: 16px;
`

const WarningText = styled.div`
  font-size: 12px;
  color: #faad14;
  font-weight: 500;
`

const RadarContainer = styled.div`
  position: relative;
  width: 160px;
  height: 160px;
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
  border: 4px solid var(--vscode-button-background);
  border-top-color: transparent;
  border-radius: 50%;
  animation: ${(props) => (props.$loading ? rotate : "none")} 2s linear infinite;
  opacity: ${(props) => (props.$loading ? 0.8 : 0.3)};
  transition: opacity 0.3s ease;
`

const HealthScore = styled.div<{ $value: number }>`
  font-size: 48px;
  font-weight: 700;
  color: ${(props) => {
		if (props.$value > 80) return "#52c41a"
		if (props.$value > 50) return "#faad14"
		if (props.$value > 0) return "#ff4d4f"
		return "var(--vscode-button-background)"
  }};
  transition: color 0.5s ease;
`

const HealthLabel = styled.div`
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  opacity: 0.7;
`

const ProgressInfo = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
`

const ProgressBarContainer = styled.div`
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
`

const ProgressBar = styled.div<{ $width: number }>`
  height: 100%;
  width: ${(props) => props.$width}%;
  background: var(--vscode-button-background);
  transition: width 0.3s ease;
`

const ProgressText = styled.div`
  font-size: 11px;
  opacity: 0.8;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
`

const ProgressStats = styled.div`
  font-size: 10px;
  opacity: 0.5;
`

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
`

const StatCard = styled.div<{ $stress?: number }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  border: 1px solid ${(props) => (props.$stress && props.$stress > 0.7 ? "#ff4d4f" : "rgba(255, 255, 255, 0.05)")};
  transition: all 0.3s ease;
  ${(props) =>
		props.$stress &&
		props.$stress > 0.7 &&
		css`
    box-shadow: 0 0 10px rgba(255, 77, 79, 0.2);
    background: rgba(255, 77, 79, 0.05);
  `}
`

const StatValue = styled.div`
  font-size: 18px;
  font-weight: 600;
`

const StatLabel = styled.div`
  font-size: 10px;
  text-transform: uppercase;
  opacity: 0.5;
  margin-top: 4px;
`

const Section = styled.div`
  margin-bottom: 32px;
`

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const SectionTitle = styled.h3`
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--vscode-foreground);
`

const AuditButton = styled.button`
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.2s;
  &:hover { background: var(--vscode-button-secondaryHoverBackground); }
  &:disabled { opacity: 0.5; cursor: default; }
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const ListItem = styled.div<{ $type?: string }>`
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border-left: 4px solid ${(props) => (props.$type === "VIOLATION" ? "#ff4d4f" : "#52c41a")};
  border-radius: 4px;
  gap: 12px;
`

const ListItemContent = styled.div`
  flex: 1;
`

const ListItemTitle = styled.div`
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 6px;
`

const ListItemDesc = styled.div`
  font-size: 13px;
  opacity: 0.8;
  margin-bottom: 8px;
  line-height: 1.4;
`

const ListItemPath = styled.div`
  font-size: 11px;
  opacity: 0.4;
  font-family: monospace;
  background: rgba(0,0,0,0.2);
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-block;
`

const ListItemRemediation = styled.div`
  font-size: 12px;
  color: #faad14;
  margin-bottom: 8px;
  font-weight: 500;
`

const HealthGain = styled.div`
  font-size: 11px;
  color: #52c41a;
  font-weight: 600;
  margin-top: 8px;
`

const ActionGroup = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`

const ActionButton = styled.button`
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  &:hover { background: var(--vscode-button-hoverBackground); }
`

const SecondaryButton = styled.button`
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 5px 15px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  &:hover { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.4); }
`

const EmptyState = styled.div`
  padding: 32px;
  text-align: center;
  opacity: 0.5;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.01);
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.1);
`

const PreviewModal = styled.div`
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 40px;
`

const PreviewContent = styled.div`
  background: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 12px;
  padding: 24px;
  max-width: 600px;
  width: 100%;
  box-shadow: 0 20px 40px rgba(0,0,0,0.4);
`

const PreviewTitle = styled.h2`
  font-size: 18px;
  margin-top: 0;
  margin-bottom: 16px;
`

const PreviewText = styled.div`
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.9;
  background: rgba(0,0,0,0.2);
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  white-space: pre-wrap;
`

const PreviewActions = styled.div`
  display: flex;
  justify-content: flex-end;
`

export default JoyZoningView
