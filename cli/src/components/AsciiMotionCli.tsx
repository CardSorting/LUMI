import { Box, Text } from "ink"
import React, { useEffect } from "react"

// Color themes
const THEME_DARK = {
	black: "black",
	petal: "#FFB7C5",
	stroke: "#F48FB1",
}

const THEME_LIGHT = {
	black: "black",
	petal: "magenta",
	stroke: "red",
}

type PlaybackAPI = {
	play: () => void
	pause: () => void
	restart: () => void
}

type AsciiMotionCliProps = {
	hasDarkBackground?: boolean
	autoPlay?: boolean
	loop?: boolean
	onReady?: (api: PlaybackAPI) => void
	onInteraction?: () => void
}

const PETAL_FRAME = [
	"                                                                                ",
	"                                                                                ",
	"                                     @@@@@                                      ",
	"                                   @@@@@@@@@                                    ",
	"                                 @@@@@@@@@@@@@                                  ",
	"                                @@@@@@@@@@@@@@@                                 ",
	"                                @@@@@@@@@@@@@@@                                 ",
	"                                 @@@@@@@@@@@@@                                  ",
	"                                   @@@@@@@@@                                    ",
	"                                     @@@@@                                      ",
	"                                       @                                        ",
	"                                                                                ",
]

/**
 * AsciiMotionCli - Sakura Petal version
 */
export const AsciiMotionCli: React.FC<AsciiMotionCliProps> = ({ hasDarkBackground = true, onReady }) => {
	const theme = hasDarkBackground ? THEME_DARK : THEME_LIGHT

	useEffect(() => {
		if (onReady) {
			onReady({
				play: () => {},
				pause: () => {},
				restart: () => {},
			})
		}
	}, [onReady])

	return (
		<Box alignItems="center" flexDirection="column" height={12} justifyContent="center" width="100%">
			{PETAL_FRAME.map((row, i) => (
				<Text color={theme.petal} key={i}>
					{row}
				</Text>
			))}
		</Box>
	)
}

/**
 * Static robot frame - now Sakura Petal
 */
export const StaticRobotFrame: React.FC<{ hasDarkBackground?: boolean }> = ({ hasDarkBackground = true }) => {
	const theme = hasDarkBackground ? THEME_DARK : THEME_LIGHT

	return (
		<Box alignItems="center" flexDirection="column" width="100%">
			<Text color={theme.petal}> 🌸 CodeMarie 🌸 </Text>
		</Box>
	)
}
