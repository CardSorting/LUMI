import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * DietCodeLogoVariable component renders the DietCode logo with automatic theme adaptation
 * and environment-based color indicators.
 *
 * This component uses VS Code theme variables for the fill color, with environment-specific colors:
 * - Local: yellow/orange (development/experimental)
 * - Staging: blue (stable testing)
 * - Production: gray/white (default icon color)
 *
 * @param {SVGProps<SVGSVGElement> & { environment?: Environment }} props - Standard SVG props plus optional environment
 * @returns {JSX.Element} SVG DietCode logo that adapts to VS Code themes and environment
 */
const DietCodeLogoVariable = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props

	// Determine fill color based on environment
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg fill="none" height="50" viewBox="0 0 100 100" width="50" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<g fill="none" stroke={fillColor} strokeWidth="8">
				<path d="M35 25 H 65 V 82 Q 65 88 59 88 H 41 Q 35 88 35 82 Z" fill={fillColor} />
				<path d="M35 25 Q 50 18 65 25" strokeLinecap="round" strokeWidth="6" />
			</g>
		</svg>
	)
}
export default DietCodeLogoVariable
