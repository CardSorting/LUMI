import type { SVGProps } from "react"

/** Soft floating companion orb — observatory spirit, not reactor core. */
export const MiraOrbPaths = ({
	accentColor = "#b8b5d6",
	coreColor = "currentColor",
	className,
}: {
	accentColor?: string
	coreColor?: string
	className?: string
}) => (
	<g className={className}>
		<circle cx="50" cy="50" fill={accentColor} opacity="0.08" r="40" />
		<circle cx="50" cy="50" fill="none" opacity="0.18" r="36" stroke={accentColor} strokeWidth="1" />
		<path
			d="M 22 48 Q 36 34 50 38"
			fill="none"
			opacity="0.22"
			stroke={accentColor}
			strokeLinecap="round"
			strokeWidth="1.25"
		/>
		<path
			d="M 78 52 Q 64 66 50 62"
			fill="none"
			opacity="0.18"
			stroke={accentColor}
			strokeLinecap="round"
			strokeWidth="1.25"
		/>
		<circle className="animate-mira-breathe" cx="50" cy="50" fill={coreColor} opacity="0.14" r="24" />
		<circle className="animate-mira-breathe" cx="50" cy="50" fill={coreColor} opacity="0.55" r="17" />
		<circle className="animate-mira-breathe" cx="50" cy="51" fill={accentColor} opacity="0.35" r="10" />
		<path
			className="animate-mira-blink"
			d="M 42 47 Q 44 45.5 46 47"
			fill="none"
			opacity="0.75"
			stroke="#faf9f7"
			strokeLinecap="round"
			strokeWidth="1.6"
		/>
		<path
			className="animate-mira-blink"
			d="M 54 47 Q 56 45.5 58 47"
			fill="none"
			opacity="0.75"
			stroke="#faf9f7"
			strokeLinecap="round"
			strokeWidth="1.6"
		/>
		<path
			d="M 50 67 L 50 74 L 54 71"
			fill="none"
			opacity="0.35"
			stroke={coreColor}
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.5"
		/>
	</g>
)

const MiraOrbIcon = (props: SVGProps<SVGSVGElement>) => (
	<svg fill="none" height="50" viewBox="0 0 100 100" width="50" xmlns="http://www.w3.org/2000/svg" {...props}>
		<MiraOrbPaths />
	</svg>
)

export default MiraOrbIcon
