import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"
import { LumiOrbPaths } from "./LumiOrbIcon"

/**
 * LUMI logo with automatic theme adaptation and environment-based color indicators.
 */
const DietCodeLogoVariable = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg fill="none" height="50" viewBox="0 0 100 100" width="50" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<LumiOrbPaths accentColor="#6bb5c9" coreColor={fillColor} />
		</svg>
	)
}

export default DietCodeLogoVariable
