import { ArrowLeft } from "lucide-react"
import { useEffect } from "react"
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

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				// Don't close if user is typing in an input or textarea
				const activeElement = document.activeElement
				if (activeElement) {
					const tagName = activeElement.tagName.toLowerCase()
					const isInput =
						tagName === "input" ||
						tagName === "textarea" ||
						activeElement.getAttribute("contenteditable") === "true" ||
						tagName.startsWith("vscode-")
					if (isInput) {
						return
					}
				}
				onDone()
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [onDone])

	return (
		<header className="flex items-center gap-1.5 py-1.5 px-2 mb-2 border-b border-border/30 shrink-0">
			<Button
				aria-label="Back to chat"
				className="h-7 w-7 shrink-0 rounded-md text-foreground/75 hover:bg-toolbar-hover hover:text-foreground transition-all"
				onClick={onDone}
				size="icon"
				title="Go Back (Esc)"
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
