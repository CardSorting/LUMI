import type { McpServer } from "@shared/mcp"
import React, { useCallback, useEffect, useRef } from "react"
import ScreenReaderAnnounce from "@/components/common/ScreenReaderAnnounce"
import { useMenuAnnouncement } from "@/hooks/useMenuAnnouncement"
import { cn } from "@/lib/utils"
import type { SlashCommand } from "@/utils/slash-commands"
import { getMatchingSlashCommands } from "@/utils/slash-commands"

interface SlashCommandMenuProps {
	onSelect: (command: SlashCommand) => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	onMouseDown: () => void
	query: string
	localWorkflowToggles?: Record<string, boolean>
	globalWorkflowToggles?: Record<string, boolean>
	remoteWorkflowToggles?: Record<string, boolean>
	remoteWorkflows?: any[]
	mcpServers?: McpServer[]
}

const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
	onSelect,
	selectedIndex,
	setSelectedIndex,
	onMouseDown,
	query,
	localWorkflowToggles = {},
	globalWorkflowToggles = {},
	remoteWorkflowToggles,
	remoteWorkflows,
	mcpServers = [],
}) => {
	const menuRef = useRef<HTMLDivElement>(null)

	// Filter commands based on query
	const filteredCommands = getMatchingSlashCommands(
		query,
		localWorkflowToggles,
		globalWorkflowToggles,
		remoteWorkflowToggles,
		remoteWorkflows,
		mcpServers,
	)
	const defaultCommands = filteredCommands.filter((cmd) => cmd.section === "default" || !cmd.section)
	const workflowCommands = filteredCommands.filter((cmd) => cmd.section === "custom")
	const mcpCommands = filteredCommands.filter((cmd) => cmd.section === "mcp")

	// Screen reader announcements
	const getCommandLabel = useCallback((command: SlashCommand) => {
		const description = command.description ? `, ${command.description}` : ""
		return `${command.name}${description}`
	}, [])

	const { announcement } = useMenuAnnouncement({
		items: filteredCommands,
		selectedIndex,
		getItemLabel: getCommandLabel,
	})

	const handleClick = useCallback(
		(command: SlashCommand) => {
			onSelect(command)
		},
		[onSelect],
	)

	useEffect(() => {
		if (menuRef.current) {
			const selectedElement = menuRef.current.querySelector(`#slash-command-menu-item-${selectedIndex}`) as HTMLElement
			if (selectedElement) {
				const menuRect = menuRef.current.getBoundingClientRect()
				const selectedRect = selectedElement.getBoundingClientRect()

				if (selectedRect.bottom > menuRect.bottom) {
					menuRef.current.scrollTop += selectedRect.bottom - menuRect.bottom
				} else if (selectedRect.top < menuRect.top) {
					menuRef.current.scrollTop -= menuRect.top - selectedRect.top
				}
			}
		}
	}, [selectedIndex])

	// Create a reusable function for rendering a command section
	const renderCommandSection = (commands: SlashCommand[], title: string, indexOffset: number, showDescriptions: boolean) => {
		if (commands.length === 0) {
			return null
		}

		return (
			<>
				<div
					className="text-[10px] text-muted-foreground px-3 py-1 font-medium border-b border-editor-group-border"
					role="presentation">
					{title}
				</div>
				{commands.map((command, index) => {
					const itemIndex = index + indexOffset
					const isSelected = itemIndex === selectedIndex
					return (
						<div
							aria-selected={isSelected}
							className={cn(
								"slash-command-menu-item py-2 px-3 cursor-pointer flex flex-col border-b border-editor-group-border",
								isSelected
									? "bg-[var(--vscode-quickInputList-focusBackground)] text-[var(--vscode-quickInputList-focusForeground)]"
									: "hover:bg-[var(--vscode-list-hoverBackground)]",
							)}
							id={`slash-command-menu-item-${itemIndex}`}
							key={command.name}
							onClick={() => handleClick(command)}
							onMouseEnter={() => setSelectedIndex(itemIndex)}
							role="option">
							<div className="font-medium whitespace-nowrap overflow-hidden text-ellipsis text-sm">
								<span className="ph-no-capture">/{command.name}</span>
							</div>
							{showDescriptions && command.description && (
								<div className="text-[0.85em] text-(--vscode-descriptionForeground) whitespace-normal overflow-hidden text-ellipsis">
									<span className="ph-no-capture">{command.description}</span>
								</div>
							)}
						</div>
					)
				})}
			</>
		)
	}

	return (
		<div
			className="border-b border-[var(--vscode-editorGroup-border)] overflow-x-hidden shrink-0"
			data-testid="slash-commands-menu"
			onMouseDown={onMouseDown}>
			<ScreenReaderAnnounce message={announcement} />
			<p className="m-0 px-3 pt-1.5 pb-0.5 text-[10px] text-muted-foreground">Quick commands</p>
			<div
				aria-activedescendant={filteredCommands.length > 0 ? `slash-command-menu-item-${selectedIndex}` : undefined}
				aria-label="Slash commands"
				className="bg-[var(--vscode-dropdown-background)] flex flex-col overflow-y-auto max-h-[min(160px,28vh)] overscroll-contain"
				ref={menuRef}
				role="listbox"
				tabIndex={0}>
				{filteredCommands.length > 0 ? (
					<>
						{renderCommandSection(defaultCommands, "Common", 0, true)}
						{renderCommandSection(workflowCommands, "Your workflows", defaultCommands.length, false)}
						{renderCommandSection(
							mcpCommands,
							"Connected tools",
							defaultCommands.length + workflowCommands.length,
							true,
						)}
					</>
				) : (
					<div aria-selected="false" className="py-2 px-3 cursor-default flex flex-col" role="option">
						<div className="text-[0.85em] text-(--vscode-descriptionForeground)">No matching commands</div>
					</div>
				)}
			</div>
		</div>
	)
}

export default SlashCommandMenu
