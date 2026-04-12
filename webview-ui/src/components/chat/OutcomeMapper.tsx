import { MoveRightIcon, ZapIcon } from "lucide-react"
import styled from "styled-components"

const OutcomeContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
  padding: 16px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-editorGroup-border);
  border-radius: 8px;
  border-left: 4px solid var(--vscode-charts-blue);
`

const OutcomeTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
`

const LabelText = styled.span`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  letter-spacing: 0.5px;
`

const PredictedText = styled.p`
  margin: 0;
  font-size: 13px;
  color: var(--vscode-foreground);
  line-height: 1.5;
  font-style: italic;
`

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 12px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: 6px;
`

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`

const StatLabel = styled.span`
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
`

const StatValue = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
`

const BlastRadiusSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const BlastItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-editorGroup-border);
  border-radius: 4px;
  font-size: 12px;
`

const BlastPath = styled.span`
  font-family: var(--vscode-editor-font-family);
  color: var(--vscode-textLink-foreground);
  font-weight: 600;
`

const BlastReason = styled.span`
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
`

interface OutcomeMapperProps {
	outcomeMapping?: {
		blastRadius?: Array<{ path: string; reason: string }>
		complexityDelta?: {
			linesAdded: number
			linesDeleted: number
			filesCreated: number
		}
		predictedOutcome?: string
	}
}

export const OutcomeMapper = ({ outcomeMapping }: OutcomeMapperProps) => {
	if (!outcomeMapping) return null

	const { blastRadius, complexityDelta, predictedOutcome } = outcomeMapping

	return (
		<OutcomeContainer>
			<OutcomeTitle>
				<ZapIcon className="text-blue-400" size={14} />
				<LabelText>Predicted Outcome & Blast Radius</LabelText>
			</OutcomeTitle>

			{predictedOutcome && <PredictedText>"{predictedOutcome}"</PredictedText>}

			{complexityDelta && (
				<StatsGrid>
					<StatItem>
						<StatLabel>+ Lines</StatLabel>
						<StatValue className="text-green-500">+{complexityDelta.linesAdded}</StatValue>
					</StatItem>
					<StatItem>
						<StatLabel>- Lines</StatLabel>
						<StatValue className="text-red-500">-{complexityDelta.linesDeleted}</StatValue>
					</StatItem>
					<StatItem>
						<StatLabel>Files++</StatLabel>
						<StatValue className="text-blue-400">{complexityDelta.filesCreated}</StatValue>
					</StatItem>
				</StatsGrid>
			)}

			{blastRadius && blastRadius.length > 0 && (
				<BlastRadiusSection>
					<LabelText style={{ fontSize: "10px" }}>Impacted Components (Side Effects)</LabelText>
					{blastRadius.map((item, i) => (
						<BlastItem key={i}>
							<MoveRightIcon className="mt-0.5 text-blue-300" size={12} />
							<div className="flex flex-col">
								<BlastPath title={item.path}>{item.path.split("/").pop()}</BlastPath>
								<BlastReason>{item.reason}</BlastReason>
							</div>
						</BlastItem>
					))}
				</BlastRadiusSection>
			)}
		</OutcomeContainer>
	)
}
