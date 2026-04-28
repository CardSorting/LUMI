import { JoyZoningAuditProgress, JoyZoningAuditResponse } from "@shared/proto/dietcode/joyzoning"
import { useCallback, useEffect, useRef, useState } from "react"
import styled, { keyframes } from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { JoyZoningServiceClient } from "@/services/grpc-client"
import ViewHeader from "../common/ViewHeader"

const lower = (value: string | null | undefined): string => (value || "").toLowerCase()

const JoyZoningView = ({ onDone }: { onDone: () => void }) => {
	const { environment } = useExtensionState()
	const [loading, setLoading] = useState(false)
	const [report, setReport] = useState<JoyZoningAuditResponse | null>(null)
	const [progress, setProgress] = useState<JoyZoningAuditProgress | null>(null)
	const [previewPlan, setPreviewPlan] = useState<string | null>(null)
	const [status, setStatus] = useState<"idle" | "starting" | "streaming" | "completed" | "error">("idle")
	const [auditLaunchMessage, setAuditLaunchMessage] = useState<string | null>(null)
	const [auditLaunchError, setAuditLaunchError] = useState<string | null>(null)
	const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
	const [batchProcessing, setBatchProcessing] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")

	const cancelRef = useRef<(() => void) | null>(null)
	const mountedRef = useRef(true)

	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			if (cancelRef.current) cancelRef.current()
		}
	}, [])

	const triggerAudit = useCallback(() => {
		if (status === "starting" || status === "streaming") return
		if (cancelRef.current) {
			cancelRef.current()
			cancelRef.current = null
		}

		setLoading(true)
		setStatus("starting")
		setAuditLaunchError(null)
		setAuditLaunchMessage(null)
		setReport(null)

		try {
			const cancel = JoyZoningServiceClient.triggerAudit(
				{ path: "", useCache: false },
				{
					onResponse: (response) => {
						setStatus("streaming")
						if (response.progress) setProgress(response.progress)
						if (response.integrityScore > 0 || (response.violations && response.violations.length > 0)) {
							setReport(response)
						}
					},
					onError: (error) => {
						setStatus("error")
						setLoading(false)
						setAuditLaunchError(error.message)
					},
					onComplete: () => {
						setStatus("completed")
						setLoading(false)
						setAuditLaunchMessage("Audit complete.")
					},
				},
			)
			cancelRef.current = cancel
		} catch (error) {
			setStatus("error")
			setLoading(false)
			setAuditLaunchError(error instanceof Error ? error.message : "Audit failed.")
		}
	}, [status])

	const executeBatchRefactor = async (dryRun = false) => {
		if (selectedItems.size === 0) return
		setBatchProcessing(true)
		setAuditLaunchError(null)

		const requests = Array.from(selectedItems).map((id) => {
			const [action, path] = id.split("::")
			return { action, path, dryRun }
		})

		try {
			const response = await JoyZoningServiceClient.executeBatchRefactor({ requests, dryRun })
			if (dryRun) {
				setPreviewPlan(response.planSummary || "No manifest available.")
			} else if (response.success) {
				setAuditLaunchMessage(`Evolution initiated for ${selectedItems.size} components.`)
				setSelectedItems(new Set())
				setTimeout(triggerAudit, 2000)
			} else {
				setAuditLaunchError(`Evolution failed: ${response.message}`)
			}
		} catch (error) {
			setAuditLaunchError(error instanceof Error ? error.message : "Orchestration failed.")
		} finally {
			setBatchProcessing(false)
			setLoading(false)
		}
	}

	const toggleSelection = (action: string, path: string) => {
		const id = `${action}::${path}`
		const newSelection = new Set(selectedItems)
		if (newSelection.has(id)) newSelection.delete(id)
		else newSelection.add(id)
		setSelectedItems(newSelection)
	}

	const actionableItems = [
		...(report?.violations || []).map((v) => ({
			...v,
			itemType: "VIOLATION",
			id: `${v.type}::${v.path}`,
			title: v.type,
			desc: v.message,
			action: v.type,
			displayImpact: v.impactArea || "STABILITY",
		})),
		...(report?.optimizations || []).map((o) => ({
			...o,
			itemType: "OPTIMIZATION",
			id: `${o.action}::${o.path}`,
			title: o.title,
			desc: o.description,
			displayImpact: o.impact,
		})),
	].filter(
		(item) =>
			lower(item.title).includes(searchQuery.toLowerCase()) ||
			lower(item.path).includes(searchQuery.toLowerCase()) ||
			lower(item.desc).includes(searchQuery.toLowerCase()),
	)

	return (
		<Container>
			<ViewHeader environment={environment} onDone={onDone} title="Apex Orchestration" />
			<Content>
				<OrchestrationHeader>
					<StatusGroup>
						<GradeBadge $grade={report?.grade || "A"}>{report?.grade || "--"}</GradeBadge>
						<HealthInfo>
							<HealthValue>{report?.integrityScore || report?.buildHealth || 0}%</HealthValue>
							<HealthLabel>INTEGRITY</HealthLabel>
						</HealthInfo>
					</StatusGroup>
					<AuditButton $primary disabled={loading} onClick={triggerAudit}>
						{loading ? "SCANNING..." : "TRIGGER AUDIT"}
					</AuditButton>
				</OrchestrationHeader>

				{report && (
					<ControlPanel>
						<SearchInput
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Filter orchestration backlog..."
							value={searchQuery}
						/>
						<BulkActions>
							<Badge $type="AUTO" onClick={() => setSelectedItems(new Set(actionableItems.map((i) => i.id)))}>
								SELECT ALL ({actionableItems.length})
							</Badge>
							<Badge $type="LOW" onClick={() => setSelectedItems(new Set())}>
								CLEAR
							</Badge>
						</BulkActions>
					</ControlPanel>
				)}

				<UnifiedList>
					{actionableItems.map((item) => (
						<ListItem
							$selected={selectedItems.has(item.id)}
							key={item.id}
							onClick={() => toggleSelection(item.action, item.path)}>
							<SelectionIndicator $selected={selectedItems.has(item.id)}>
								{selectedItems.has(item.id) ? "✓" : ""}
							</SelectionIndicator>
							<ListItemContent>
								<BadgeGroup>
									<Badge $type={item.itemType}>{item.itemType}</Badge>
									{item.displayImpact && <Badge $type={item.displayImpact}>{item.displayImpact} IMPACT</Badge>}
									{"riskLevel" in item && item.riskLevel && (
										<Badge $type={item.riskLevel}>{item.riskLevel} RISK</Badge>
									)}
								</BadgeGroup>
								<ListItemTitle>{item.title}</ListItemTitle>
								<ListItemDesc>{item.desc}</ListItemDesc>
								<ListItemPath>{item.path}</ListItemPath>
							</ListItemContent>
						</ListItem>
					))}
					{report && actionableItems.length === 0 && <EmptyState>No items identified.</EmptyState>}
				</UnifiedList>

				{selectedItems.size > 0 && (
					<BatchBar>
						<BatchCount>
							<PulseDot /> {selectedItems.size} Selected
						</BatchCount>
						<BatchActions>
							<ActionButton $primary disabled={batchProcessing} onClick={() => executeBatchRefactor(true)}>
								{batchProcessing ? "WAIT..." : "REVIEW MANIFEST"}
							</ActionButton>
						</BatchActions>
					</BatchBar>
				)}

				{loading && progress && (
					<LoadingOverlay>
						<ProgressText>Forensic Scan: {progress.currentFile?.split("/").pop()}</ProgressText>
						<ProgressBarContainer>
							<ProgressBar $width={progress.percentage || 0} />
						</ProgressBarContainer>
					</LoadingOverlay>
				)}

				{auditLaunchMessage && <Notice $type="success">{auditLaunchMessage}</Notice>}
				{auditLaunchError && <Notice $type="error">{auditLaunchError}</Notice>}

				{previewPlan && (
					<Modal>
						<ModalContent>
							<ModalTitle>Apex Manifest</ModalTitle>
							<ModalText>{previewPlan}</ModalText>
							<ModalActions>
								<SecondaryButton onClick={() => setPreviewPlan(null)}>DISMISS</SecondaryButton>
								<ActionButton
									$primary
									disabled={batchProcessing}
									onClick={() => {
										setPreviewPlan(null)
										executeBatchRefactor(false)
									}}>
									{batchProcessing ? "EXECUTING..." : "EXECUTE"}
								</ActionButton>
							</ModalActions>
						</ModalContent>
					</Modal>
				)}
			</Content>
		</Container>
	)
}

const pulse = keyframes`0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; }`

const Container = styled.div`position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--vscode-sideBar-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family);`
const Content = styled.div`flex: 1; overflow-y: auto; display: flex; flex-direction: column;`
const OrchestrationHeader = styled.div`display: flex; justify-content: space-between; align-items: center; padding: 20px; background: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(255,255,255,0.05);`
const StatusGroup = styled.div`display: flex; align-items: center; gap: 16px;`
const GradeBadge = styled.div<{
	$grade: string
}>`font-size: 42px; font-weight: 900; color: ${(props) => (props.$grade === "A" ? "#52c41a" : props.$grade === "B" ? "#b7eb8f" : props.$grade === "C" ? "#faad14" : "#ff4d4f")};`
const HealthInfo = styled.div`display: flex; flex-direction: column;`
const HealthValue = styled.div`font-size: 20px; font-weight: 800;`
const HealthLabel = styled.div`font-size: 9px; opacity: 0.4; font-weight: 700; letter-spacing: 1px;`
const ControlPanel = styled.div`display: flex; flex-direction: column; gap: 12px; padding: 16px;`
const BulkActions = styled.div`display: flex; gap: 8px;`
const UnifiedList = styled.div`display: flex; flex-direction: column; gap: 8px; padding: 0 16px 100px 16px;`
const ListItem = styled.div<{
	$selected?: boolean
}>`background: ${(props) => (props.$selected ? "rgba(24, 144, 255, 0.08)" : "rgba(255, 255, 255, 0.02)")}; border-radius: 12px; padding: 16px; display: flex; gap: 16px; border: 1px solid ${(props) => (props.$selected ? "rgba(24, 144, 255, 0.3)" : "rgba(255, 255, 255, 0.04)")}; cursor: pointer; transition: all 0.2s ease;`
const SelectionIndicator = styled.div<{
	$selected?: boolean
}>`width: 18px; height: 18px; border-radius: 4px; border: 2px solid ${(props) => (props.$selected ? "var(--vscode-button-background)" : "rgba(255,255,255,0.1)")}; background: ${(props) => (props.$selected ? "var(--vscode-button-background)" : "transparent")}; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold; flex-shrink: 0;`
const ListItemContent = styled.div`display: flex; flex-direction: column; gap: 6px;`
const ListItemTitle = styled.div`font-weight: 800; font-size: 13px;`
const ListItemDesc = styled.div`font-size: 11px; opacity: 0.7; line-height: 1.4;`
const ListItemPath = styled.div`font-size: 9px; opacity: 0.3; font-family: var(--vscode-editor-font-family); background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; align-self: flex-start;`
const BadgeGroup = styled.div`display: flex; gap: 6px;`
const Badge = styled.div<{
	$type: string
}>`font-size: 8px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; cursor: pointer; ${(props) => (props.$type === "VIOLATION" ? "background: rgba(255, 77, 79, 0.15); color: #ff4d4f;" : props.$type === "OPTIMIZATION" ? "background: rgba(24, 144, 255, 0.15); color: #1890ff;" : props.$type === "AUTO" ? "background: rgba(82, 196, 26, 0.15); color: #52c41a;" : "background: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.5);")}`
const BatchBar = styled.div`position: sticky; bottom: 0; background: rgba(30, 30, 30, 0.9); backdrop-filter: blur(10px); border-top: 1px solid rgba(255, 255, 255, 0.1); padding: 16px; display: flex; align-items: center; justify-content: space-between; z-index: 100; box-shadow: 0 -8px 24px rgba(0,0,0,0.4);`
const BatchCount = styled.div`display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #1890ff;`
const BatchActions = styled.div`display: flex; gap: 8px;`
const PulseDot = styled.div`width: 8px; height: 8px; background: #1890ff; border-radius: 50%; box-shadow: 0 0 8px #1890ff; animation: ${pulse} 1.5s infinite;`
const AuditButton = styled.button<{
	$primary?: boolean
}>`background: ${(props) => (props.$primary ? "var(--vscode-button-background)" : "rgba(255, 255, 255, 0.05)")}; color: ${(props) => (props.$primary ? "var(--vscode-button-foreground)" : "var(--vscode-foreground)")}; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 11px; font-weight: 800; transition: all 0.2s; &:hover { opacity: 0.9; }`
const ActionButton = styled(AuditButton)`padding: 10px 20px;`
const SecondaryButton = styled.button`background: transparent; color: var(--vscode-foreground); border: 1px solid rgba(255,255,255,0.1); padding: 8px 16px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;`
const SearchInput = styled.input`width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px 14px; color: var(--vscode-foreground); font-size: 12px; &:focus { outline: none; border-color: var(--vscode-button-background); }`
const EmptyState = styled.div`padding: 40px; text-align: center; opacity: 0.3; font-size: 12px; font-style: italic;`
const LoadingOverlay = styled.div`position: absolute; inset: 0; background: rgba(0,0,0,0.7); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 2000; backdrop-filter: blur(4px); gap: 16px;`
const ProgressBarContainer = styled.div`width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;`
const ProgressBar = styled.div<{
	$width: number
}>`height: 100%; width: ${(props) => props.$width}%; background: var(--vscode-button-background); transition: width 0.3s;`
const ProgressText = styled.div`font-size: 11px; opacity: 0.8; font-family: var(--vscode-editor-font-family);`
const Notice = styled.div<{
	$type: "success" | "error"
}>`padding: 12px; margin: 16px; border-radius: 8px; font-size: 11px; font-weight: 700; text-align: center; background: ${(props) => (props.$type === "success" ? "rgba(82, 196, 26, 0.1)" : "rgba(255, 77, 79, 0.1)")}; color: ${(props) => (props.$type === "success" ? "#52c41a" : "#ff4d4f")};`
const Modal = styled.div`position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 3000; padding: 20px; backdrop-filter: blur(10px);`
const ModalContent = styled.div`background: var(--vscode-sideBar-background); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; max-width: 500px; width: 100%; display: flex; flex-direction: column; gap: 16px;`
const ModalTitle = styled.h2`font-size: 16px; margin: 0; font-weight: 800;`
const ModalText = styled.div`font-size: 12px; line-height: 1.6; opacity: 0.8; background: rgba(0,0,0,0.2); padding: 16px; border-radius: 12px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; font-family: var(--vscode-editor-font-family);`
const ModalActions = styled.div`display: flex; justify-content: flex-end; gap: 8px;`

export default JoyZoningView
