import { AlertTriangleIcon, CheckCircle2Icon, FingerprintIcon, HelpCircleIcon, SearchIcon, UsersIcon } from "lucide-react"
import styled from "styled-components"
import { Badge } from "@/components/ui/badge"

const HubContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
  padding: 16px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-editorGroup-border);
  border-radius: 8px;
  border-left: 4px solid var(--vscode-symbolIcon-interfaceForeground);
`

const HubHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const LabelText = styled.span`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  letter-spacing: 0.5px;
`

const ConsensusSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: 6px;
`

const ConsensusBar = styled.div`
  width: 100%;
  height: 6px;
  background: var(--vscode-editorGroup-border);
  border-radius: 3px;
  overflow: hidden;
`

const ConsensusFill = styled.div<{ $percent: number }>`
  height: 100%;
  width: ${(props) => props.$percent}%;
  background: var(--vscode-symbolIcon-interfaceForeground);
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
`

const ConsensusText = styled.p`
  margin: 0;
  font-size: 12px;
  color: var(--vscode-foreground);
  line-height: 1.4;
`

const FeedbackList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
`

const FeedbackBadge = styled.div`
  font-size: 10px;
  padding: 2px 8px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-editorGroup-border);
  border-radius: 10px;
  color: var(--vscode-descriptionForeground);
`

const ClarificationList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ActionButton = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: 1px solid var(--vscode-button-border);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;

  &:hover {
    background: var(--vscode-button-secondaryHoverBackground);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  &:active {
    transform: translateY(0);
  }
`

interface ClarificationHubProps {
	interactiveClarifications?: Array<{
		label: string
		type: "provide_path" | "clarify_intent" | "select_variant" | "confirm_risk"
		data?: Record<string, any>
	}>
	swarmConsensus?: {
		agreementScore: number
		consensusNarrative: string
		agentFeedback: string[]
	}
}

export const ClarificationHub = ({ interactiveClarifications, swarmConsensus }: ClarificationHubProps) => {
	if (!interactiveClarifications && !swarmConsensus) return null

	return (
		<HubContainer>
			<HubHeader>
				<Title>
					<HelpCircleIcon className="text-purple-400" size={14} />
					<LabelText>Interactive Clarification & Consensus</LabelText>
				</Title>
				{swarmConsensus && (
					<Badge className="text-[10px] font-bold" variant="codemarie">
						{Math.round(swarmConsensus.agreementScore * 100)}% CONSENSUS
					</Badge>
				)}
			</HubHeader>

			{swarmConsensus && (
				<ConsensusSection>
					<ConsensusBar>
						<ConsensusFill $percent={swarmConsensus.agreementScore * 100} />
					</ConsensusBar>
					<ConsensusText>{swarmConsensus.consensusNarrative}</ConsensusText>
					<FeedbackList>
						{swarmConsensus.agentFeedback.map((f, i) => (
							<FeedbackBadge key={i}>
								<UsersIcon className="inline mr-1" size={8} />
								{f}
							</FeedbackBadge>
						))}
					</FeedbackList>
				</ConsensusSection>
			)}

			{interactiveClarifications && interactiveClarifications.length > 0 && (
				<ClarificationList>
					<LabelText style={{ fontSize: "10px", marginBottom: "4px" }}>
						Suggested Actions to Resolve Ambiguity
					</LabelText>
					{interactiveClarifications.map((c, i) => (
						<ActionButton key={i} onClick={() => console.log("Action triggered:", c)}>
							{c.type === "provide_path" && <FingerprintIcon className="text-blue-400" size={16} />}
							{c.type === "clarify_intent" && <SearchIcon className="text-orange-400" size={16} />}
							{c.type === "select_variant" && <CheckCircle2Icon className="text-green-400" size={16} />}
							{c.type === "confirm_risk" && <AlertTriangleIcon className="text-red-400" size={16} />}
							<div className="flex flex-col">
								<span className="font-semibold">{c.label}</span>
								<span className="text-[11px] opacity-70">Requires your input to proceed optimally</span>
							</div>
						</ActionButton>
					))}
				</ClarificationList>
			)}
		</HubContainer>
	)
}
