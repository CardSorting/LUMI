/**
 * CheckpointView component for CLI
 * Displays a list of task checkpoints and allows browsing them
 */

import { Box, Text, useInput } from "ink"
import React, { useMemo, useState } from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { Panel } from "./Panel"

interface Checkpoint {
	id: string
	ts: number
	description?: string
}

interface CheckpointViewProps {
	onClose: () => void
	checkpoints?: Checkpoint[]
}

const MAX_VISIBLE = 10
const SEPARATOR = "────────────────────────────────────────────────────────────────────────────────"

export const CheckpointView: React.FC<CheckpointViewProps> = ({ onClose, checkpoints = [] }) => {
	const { isRawModeSupported } = useStdinContext()
	const [selectedIndex, setSelectedIndex] = useState(0)

	// Sort checkpoints by timestamp (newest first)
	const sortedCheckpoints = useMemo(() => {
		return [...checkpoints].sort((a, b) => b.ts - a.ts)
	}, [checkpoints])

	const currentListLength = sortedCheckpoints.length

	useInput(
		(_input, key) => {
			if (key.escape) {
				onClose()
			}

			if (key.upArrow) {
				setSelectedIndex((i) => (i > 0 ? i - 1 : currentListLength - 1))
			} else if (key.downArrow) {
				setSelectedIndex((i) => (i < currentListLength - 1 ? i + 1 : 0))
			}

			if (key.return || key.tab) {
				// For now, just show info? In the future, maybe "Restore" action
			}
		},
		{ isActive: isRawModeSupported },
	)

	const halfVisible = Math.floor(MAX_VISIBLE / 2)
	const startIndex = Math.max(0, Math.min(selectedIndex - halfVisible, currentListLength - MAX_VISIBLE))
	const visibleCheckpoints = sortedCheckpoints.slice(startIndex, startIndex + MAX_VISIBLE)

	return (
		<Panel label="📍 Project Checkpoints">
			<Box flexDirection="column" paddingX={1}>
				{currentListLength === 0 ? (
					<Box paddingY={1}>
						<Text color="gray">No checkpoints found for this task.</Text>
					</Box>
				) : (
					<React.Fragment>
						<Box marginBottom={1}>
							<Text color="gray">Browse project states and history.</Text>
						</Box>
						<Box flexDirection="column">
							{visibleCheckpoints.map((checkpoint, idx) => {
								const actualIndex = startIndex + idx
								const isSelected = actualIndex === selectedIndex
								const date = new Date(checkpoint.ts).toLocaleString()

								return (
									<Box key={checkpoint.id}>
										<Text color={isSelected ? COLORS.primaryBlue : "white"}>{isSelected ? "› " : "  "}</Text>
										<Box flexDirection="column">
											<Text bold={isSelected} color={isSelected ? COLORS.primaryBlue : "white"}>
												{checkpoint.description || `Checkpoint ${checkpoint.id.slice(0, 8)}`}
											</Text>
											<Text color="gray" dimColor>
												{date}
											</Text>
										</Box>
									</Box>
								)
							})}
						</Box>

						{currentListLength > MAX_VISIBLE && (
							<Box marginTop={1}>
								<Text color="gray">
									{startIndex > 0 ? "↑ " : "  "}
									Showing {startIndex + 1}-{Math.min(startIndex + MAX_VISIBLE, currentListLength)} of{" "}
									{currentListLength}
									{startIndex + MAX_VISIBLE < currentListLength ? " ↓" : "  "}
								</Text>
							</Box>
						)}
					</React.Fragment>
				)}

				<Text color="gray">{SEPARATOR}</Text>
				<Text color="gray">↑/↓ Navigate • Esc Back</Text>
			</Box>
		</Panel>
	)
}
