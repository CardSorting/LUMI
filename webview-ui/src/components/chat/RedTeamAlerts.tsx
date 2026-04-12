import { CheckCircleIcon, ShieldAlertIcon, ZapOffIcon } from "lucide-react"
import styled from "styled-components"
import { Badge } from "@/components/ui/badge"

const RedTeamContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
  padding: 16px;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 8px;
  border-left: 4px solid var(--vscode-errorForeground);
`

const Header = styled.div`
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
  color: var(--vscode-errorForeground);
  letter-spacing: 0.5px;
`

const CritiqueText = styled.p`
  margin: 0;
  font-size: 13px;
  color: var(--vscode-foreground);
  line-height: 1.5;
  font-weight: 500;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const ListItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
`

const PitfallItem = styled(ListItem)`
  background: rgba(255, 0, 0, 0.1);
  color: var(--vscode-errorForeground);
  border: 1px solid rgba(255, 0, 0, 0.2);
`

const MitigationItem = styled(ListItem)`
  background: rgba(0, 255, 0, 0.05);
  color: var(--vscode-testing-iconPassed);
  border: 1px solid rgba(0, 255, 0, 0.1);
`

const RiskBarContainer = styled.div`
  width: 100%;
  height: 4px;
  background: var(--vscode-editorGroup-border);
  border-radius: 2px;
  margin-top: 4px;
  overflow: hidden;
`

const RiskBarFill = styled.div<{ $percent: number }>`
  height: 100%;
  width: ${(props) => props.$percent}%;
  background: ${(props) => (props.$percent > 70 ? "var(--vscode-errorForeground)" : props.$percent > 40 ? "var(--vscode-charts-orange)" : "var(--vscode-charts-green)")};
  transition: width 0.3s ease;
`

interface RedTeamAlertsProps {
	adversarialCritique?: {
		critique: string
		pitfalls: string[]
		mitigations: string[]
		redTeamScore: number
	}
}

export const RedTeamAlerts = ({ adversarialCritique }: RedTeamAlertsProps) => {
	if (!adversarialCritique) return null

	const { critique, pitfalls, mitigations, redTeamScore } = adversarialCritique
	const riskPercent = Math.min(100, Math.max(0, redTeamScore * 100))

	return (
		<RedTeamContainer>
			<Header>
				<Title>
					<ShieldAlertIcon className="text-red-500" size={14} />
					<LabelText>Adversarial Red-Team Audit</LabelText>
				</Title>
				<Badge className="text-[10px] uppercase opacity-70" variant="outline">
					Risk Score: {(redTeamScore * 10).toFixed(1)}/10
				</Badge>
			</Header>

			<Section>
				<RiskBarContainer>
					<RiskBarFill $percent={riskPercent} />
				</RiskBarContainer>
			</Section>

			<CritiqueText>"{critique}"</CritiqueText>

			{pitfalls.length > 0 && (
				<Section>
					<LabelText style={{ fontSize: "10px", opacity: 0.8 }}>Potential Pitfalls</LabelText>
					<List>
						{pitfalls.map((p, i) => (
							<PitfallItem key={i}>
								<ZapOffIcon className="mt-0.5 shrink-0" size={12} />
								<span>{p}</span>
							</PitfallItem>
						))}
					</List>
				</Section>
			)}

			{mitigations.length > 0 && (
				<Section>
					<LabelText style={{ fontSize: "10px", opacity: 0.8 }}>Recommended Mitigations</LabelText>
					<List>
						{mitigations.map((m, i) => (
							<MitigationItem key={i}>
								<CheckCircleIcon className="mt-0.5 shrink-0" size={12} />
								<span>{m}</span>
							</MitigationItem>
						))}
					</List>
				</Section>
			)}
		</RedTeamContainer>
	)
}
