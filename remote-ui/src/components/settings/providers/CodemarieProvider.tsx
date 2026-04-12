import { Mode } from "@shared/storage/types"
import { CodemarieAccountInfoCard } from "../CodemarieAccountInfoCard"
import CodemarieModelPicker from "../CodemarieModelPicker"

/**
 * Props for the CodemarieProvider component
 */
interface CodemarieProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

/**
 * The Codemarie provider configuration component
 */
export const CodemarieProvider = ({ showModelOptions, isPopup, currentMode, initialModelTab }: CodemarieProviderProps) => {
	return (
		<div>
			{/* Codemarie Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<CodemarieAccountInfoCard />
			</div>

			{showModelOptions && (
				<CodemarieModelPicker
					currentMode={currentMode}
					initialTab={initialModelTab}
					isPopup={isPopup}
					showProviderRouting={true}
				/>
			)}
		</div>
	)
}
