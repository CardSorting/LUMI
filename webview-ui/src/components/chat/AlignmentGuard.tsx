import styled from "styled-components"
import { Badge } from "@/components/ui/badge"
import { VscIcon } from "@/components/ui/vsc-icon"

const GuardContainer = styled.div<{ isAligned: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
  padding: 16px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-editorGroup-border);
  border-radius: 8px;
  border-right: 4px solid ${(props) => (props.isAligned ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)")};
`

const AlignmentTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
`

const LabelText = styled.span`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  letter-spacing: 0.5px;
`

const StatusBadge = styled(Badge)`
  font-size: 10px;
  text-transform: uppercase;
`

const ReasoningText = styled.p`
  margin: 0;
  font-size: 13px;
  color: var(--vscode-foreground);
  line-height: 1.5;
`

const ViolationList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding: 10px;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 4px;
`

const ViolationItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--vscode-errorForeground);
`

const LayerMap = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--vscode-editorGroup-border);
`

const LayerBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 8px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 12px;
  border: 1px solid var(--vscode-editorGroup-border);
`

const LayerIcon = styled.span`
  font-size: 10px;
`

interface AlignmentGuardProps {
	policyCompliance?: {
		isAligned: boolean
		reasoning: string
		violations?: string[]
	}
	architecturalLayers?: Record<string, "domain" | "core" | "infrastructure" | "ui" | "plumbing">
}

export const AlignmentGuard = ({ policyCompliance, architecturalLayers }: AlignmentGuardProps) => {
	if (!policyCompliance && !architecturalLayers) return null

	const getLayerIcon = (layer: string) => {
		switch (layer) {
			case "domain":
				return "🎯"
			case "core":
				return "🏗️"
			case "infrastructure":
				return "🔌"
			case "ui":
				return "🖼️"
			case "plumbing":
				return "🔧"
			default:
				return "📄"
		}
	}

	return (
		<GuardContainer isAligned={policyCompliance?.isAligned ?? true}>
			<AlignmentTitle>
				<LabelText>Architectural Alignment Guard</LabelText>
				{policyCompliance && (
					<StatusBadge variant={policyCompliance.isAligned ? "success" : "danger"}>
						{policyCompliance.isAligned ? "Aligned" : "Violation Detected"}
					</StatusBadge>
				)}
			</AlignmentTitle>

			{policyCompliance && <ReasoningText>{policyCompliance.reasoning}</ReasoningText>}

			{policyCompliance?.violations && policyCompliance.violations.length > 0 && (
				<ViolationList>
					{policyCompliance.violations.map((v) => (
						<ViolationItem key={v}>
							<VscIcon className="pt-0.5" name="warning" />
							<span>{v}</span>
						</ViolationItem>
					))}
				</ViolationList>
			)}

			{architecturalLayers && Object.keys(architecturalLayers).length > 0 && (
				<LayerMap>
					{Object.entries(architecturalLayers).map(([file, layer]) => (
						<LayerBadge key={file} title={file}>
							<LayerIcon>{getLayerIcon(layer)}</LayerIcon>
							<span className="font-bold uppercase text-[9px]">{layer}:</span>
							{file.split("/").pop()}
						</LayerBadge>
					))}
				</LayerMap>
			)}
		</GuardContainer>
	)
}
