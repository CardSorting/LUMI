import styled from "styled-components"

const DecompositionContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  background: var(--vscode-sideBar-background);
  border-radius: 6px;
  border-left: 3px solid var(--vscode-button-background);
`

const PhaseItem = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
`

const PhaseBadge = styled.span`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  padding: 2px 6px;
  border-radius: 4px;
  min-width: 60px;
  text-align: center;
`

const GoalText = styled.span`
  font-size: 12px;
  color: var(--vscode-foreground);
  line-height: 1.4;
`

const SectionTitle = styled.div`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;
  letter-spacing: 0.5px;
`

interface IntentDecompositionProps {
	phases: Array<{
		phase: string
		goal: string
	}>
}

export const IntentDecomposition = ({ phases }: IntentDecompositionProps) => {
	if (!phases || phases.length === 0) return null

	return (
		<DecompositionContainer>
			<SectionTitle>Intent Decomposition</SectionTitle>
			{phases.map((p, i) => (
				<PhaseItem key={i}>
					<PhaseBadge>{p.phase}</PhaseBadge>
					<GoalText>{p.goal}</GoalText>
				</PhaseItem>
			))}
		</DecompositionContainer>
	)
}
