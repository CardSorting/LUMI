import { Button } from "@/components/ui/button"
import Section from "../Section"

interface DebugSectionProps {
	onResetState: (resetGlobalState?: boolean) => Promise<void>
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const DebugSection = ({ onResetState, renderSectionHeader }: DebugSectionProps) => {
	return (
		<div>
			{renderSectionHeader("debug")}
			<Section>
				<Button onClick={() => onResetState()} variant="error">
					Reset Workspace State
				</Button>
				<Button onClick={() => onResetState(true)} variant="error">
					Reset Global State
				</Button>
				<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
					This will reset all global state and secret storage in the extension.
				</p>
			</Section>
		</div>
	)
}

export default DebugSection
