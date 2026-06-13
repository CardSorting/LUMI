import { TelemetrySettingEnum, TelemetrySettingRequest } from "@shared/proto/dietcode/state"
import { useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"

const telemetryRequest = TelemetrySettingRequest.create({
	setting: TelemetrySettingEnum.ENABLED,
})

export const TelemetryBanner: React.FC = () => {
	const { navigateToSettings } = useExtensionState()

	const handleClose = useCallback(() => {
		StateServiceClient.updateTelemetrySetting(telemetryRequest).catch(console.error)
	}, [])

	const handleOpenSettings = useCallback(() => {
		handleClose()
		navigateToSettings()
	}, [handleClose, navigateToSettings])

	return (
		<div className="bg-banner-background text-banner-foreground px-3 py-2 flex flex-col gap-1 shrink-0 mb-1 relative text-sm m-4">
			<h3 className="m-0 font-medium">Help MIRA get a little better</h3>
			<p className="m-0 text-description/90">
				Optional error and usage data helps fix bugs and improve the extension. No code, prompts, or personal info is
				sent.
			</p>
			<p className="m-0">
				<span>You can turn this setting off in </span>
				<span className="text-link cursor-pointer" onClick={handleOpenSettings}>
					settings
				</span>
				.
			</p>

			{/* Close button */}
			<button
				aria-label="Close banner and enable telemetry"
				className="absolute top-3 right-3 opacity-70 hover:opacity-100 cursor-pointer border-0 bg-transparent p-0 text-inherit"
				onClick={handleClose}
				type="button">
				✕
			</button>
		</div>
	)
}

export default TelemetryBanner
