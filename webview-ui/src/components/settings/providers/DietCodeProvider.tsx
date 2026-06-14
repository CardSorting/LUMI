import { Mode } from "@shared/storage/types"
import { DietCodeAccountInfoCard } from "../DietCodeAccountInfoCard"
import DietCodeModelPicker from "../DietCodeModelPicker"

/**
 * Props for the DietCodeProvider component
 */
interface DietCodeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

/**
 * The LUMI provider configuration component
 */
export const DietCodeProvider = ({ showModelOptions, isPopup, currentMode, initialModelTab }: DietCodeProviderProps) => {
	return (
		<div>
			{/* LUMI Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<DietCodeAccountInfoCard />
			</div>

			{showModelOptions && (
				<DietCodeModelPicker
					currentMode={currentMode}
					initialTab={initialModelTab}
					isPopup={isPopup}
					showProviderRouting={true}
				/>
			)}
		</div>
	)
}
