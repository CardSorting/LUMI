import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getEnvironmentColor } from "@/utils/environmentColors"
import type { Environment } from "../../../../src/shared/config-types"

const ENV_DISPLAY_NAMES: Record<Environment, string> = {
	production: "Production",
	staging: "Staging",
	local: "Local",
	selfHosted: "Self-hosted",
}

type ViewHeaderProps = {
	title: string
	onDone: () => void
	showEnvironmentSuffix?: boolean
	environment?: Environment
}

/**
 * Standard back-navigation header for overlay views (History, Settings, etc.).
 * Uses a back arrow — a pattern users recognize from mobile and web apps.
 */
const ViewHeader = ({ title, onDone, showEnvironmentSuffix, environment }: ViewHeaderProps) => {
	const showSubtext = showEnvironmentSuffix && environment && environment !== "production"
	const capitalizedEnv = environment ? ENV_DISPLAY_NAMES[environment] : ""
	const titleColor = getEnvironmentColor(environment)

	return (
		<header className="flex items-center gap-1.5 py-1.5 px-2 mb-2 border-b border-border/30 shrink-0">
			<Button
				aria-label="Back to chat"
				className="h-7 w-7 shrink-0 rounded-md"
				onClick={onDone}
				size="icon"
				variant="ghost">
				<ArrowLeft aria-hidden className="size-4" />
			</Button>
			<div className="flex-1 min-w-0">
				<h1 className="m-0 text-sm font-medium truncate" style={{ color: titleColor }}>
					{title}
				</h1>
				{showSubtext && <p className="m-0 text-xs text-muted-foreground truncate">{capitalizedEnv} environment</p>}
			</div>
		</header>
	)
}

export default ViewHeader
