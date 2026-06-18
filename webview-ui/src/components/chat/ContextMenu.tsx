import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import ScreenReaderAnnounce from "@/components/common/ScreenReaderAnnounce"
import { VscIcon } from "@/components/ui/vsc-icon"
import { useMenuAnnouncement } from "@/hooks/useMenuAnnouncement"
import { cn } from "@/lib/utils"
import { ContextMenuOptionType, ContextMenuQueryItem, getContextMenuOptions, SearchResult } from "@/utils/context-mentions"

interface ContextMenuProps {
	onSelect: (type: ContextMenuOptionType, value?: string) => void
	searchQuery: string
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: ContextMenuOptionType | null
	queryItems: ContextMenuQueryItem[]
	dynamicSearchResults?: SearchResult[]
	isLoading?: boolean
}

const ContextMenu: React.FC<ContextMenuProps> = ({
	onSelect,
	searchQuery,
	onMouseDown,
	selectedIndex,
	setSelectedIndex,
	selectedType,
	queryItems,
	dynamicSearchResults = [],
	isLoading = false,
}) => {
	const menuRef = useRef<HTMLDivElement>(null)

	// State to show delayed loading indicator
	const [showDelayedLoading, setShowDelayedLoading] = useState(false)
	const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	const filteredOptions = useMemo(() => {
		const options = getContextMenuOptions(searchQuery, selectedType, queryItems, dynamicSearchResults)
		return options
	}, [searchQuery, selectedType, queryItems, dynamicSearchResults])

	// Effect to handle delayed loading indicator (show "Searching..." after 500ms of searching)
	useEffect(() => {
		if (loadingTimeoutRef.current) {
			clearTimeout(loadingTimeoutRef.current)
			loadingTimeoutRef.current = null
		}

		if (isLoading && searchQuery) {
			setShowDelayedLoading(false)
			loadingTimeoutRef.current = setTimeout(() => {
				if (isLoading) {
					setShowDelayedLoading(true)
				}
			}, 500) // 500ms delay before showing "Searching..."
		} else {
			setShowDelayedLoading(false)
		}

		// Cleanup timeout on unmount or when dependencies change
		return () => {
			if (loadingTimeoutRef.current) {
				clearTimeout(loadingTimeoutRef.current)
				loadingTimeoutRef.current = null
			}
		}
	}, [isLoading, searchQuery])

	useEffect(() => {
		if (menuRef.current) {
			const selectedElement = menuRef.current.children[selectedIndex] as HTMLElement
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

	// Shared label definitions for simple option types
	const SIMPLE_OPTION_LABELS: Partial<Record<ContextMenuOptionType, string>> = {
		[ContextMenuOptionType.Problems]: "Problems",
		[ContextMenuOptionType.Terminal]: "Terminal",
		[ContextMenuOptionType.URL]: "Paste URL to fetch contents",
		[ContextMenuOptionType.NoResults]: "No results found",
	}

	// Get accessible label for an option (used for screen readers and aria-label)
	const getOptionLabel = useCallback(
		(option: ContextMenuQueryItem): string => {
			// Check simple labels first
			const simpleLabel = SIMPLE_OPTION_LABELS[option.type]
			if (simpleLabel) {
				return simpleLabel
			}

			switch (option.type) {
				case ContextMenuOptionType.Git:
					if (option.value) {
						return `${option.label}${option.description ? `, ${option.description}` : ""}`
					}
					return "Git Commits"
				case ContextMenuOptionType.File:
				case ContextMenuOptionType.Folder:
					if (option.value) {
						return option.label || option.value
					}
					return `Add ${option.type === ContextMenuOptionType.File ? "File" : "Folder"}`
				default:
					return option.label || option.value || ""
			}
		},
		[SIMPLE_OPTION_LABELS],
	)

	const renderOptionContent = (option: ContextMenuQueryItem) => {
		// Handle simple label types
		const simpleLabel = SIMPLE_OPTION_LABELS[option.type]
		if (simpleLabel) {
			return <span>{simpleLabel}</span>
		}

		switch (option.type) {
			case ContextMenuOptionType.Git:
				if (option.value) {
					return (
						<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
							<span className="ph-no-capture" style={{ lineHeight: "1.2" }}>
								{option.label}
							</span>
							<span
								className="ph-no-capture"
								style={{
									fontSize: "0.85em",
									opacity: 0.7,
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
									lineHeight: "1.2",
								}}>
								{option.description}
							</span>
						</div>
					)
				}
				return <span>Git Commits</span>
			case ContextMenuOptionType.File:
			case ContextMenuOptionType.Folder:
				if (option.value) {
					// Use label if it differs from just the basename (indicates workspace prefix or custom label)
					const displayText =
						option.label && option.label !== option.value.split("/").pop() ? option.label : option.value

					return (
						<>
							{!displayText.includes(":") && <span>/</span>}
							{displayText.startsWith("/.") && <span>.</span>}
							<span
								className="ph-no-capture"
								style={{
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
									direction: displayText.includes(":") ? "ltr" : "rtl",
									textAlign: "left",
								}}>
								{displayText.includes(":") ? displayText : `${cleanPathPrefix(displayText)}\u200E`}
							</span>
						</>
					)
				}
				return <span>Add {option.type === ContextMenuOptionType.File ? "File" : "Folder"}</span>
			default:
				return null
		}
	}

	const getIconForOption = (option: ContextMenuQueryItem): string => {
		switch (option.type) {
			case ContextMenuOptionType.File:
				return "file"
			case ContextMenuOptionType.Folder:
				return "folder"
			case ContextMenuOptionType.Problems:
				return "warning"
			case ContextMenuOptionType.Terminal:
				return "terminal"
			case ContextMenuOptionType.URL:
				return "link"
			case ContextMenuOptionType.Git:
				return "git-commit"
			case ContextMenuOptionType.NoResults:
				return "info"
			default:
				return "file"
		}
	}

	const isOptionSelectable = (option: ContextMenuQueryItem): boolean => {
		return option.type !== ContextMenuOptionType.NoResults && option.type !== ContextMenuOptionType.URL
	}

	// Screen reader announcements
	const { announcement } = useMenuAnnouncement({
		items: filteredOptions,
		selectedIndex,
		getItemLabel: getOptionLabel,
		isItemSelectable: isOptionSelectable,
	})

	// Handle selection with announcement
	const handleSelect = useCallback(
		(option: ContextMenuQueryItem) => {
			if (isOptionSelectable(option)) {
				const mentionValue = option.label?.includes(":") ? option.label : option.value
				onSelect(option.type, mentionValue)
			}
		},
		[onSelect, isOptionSelectable],
	)

	return (
		<div className="border-b border-[var(--vscode-editorGroup-border)] overflow-x-hidden shrink-0" onMouseDown={onMouseDown}>
			<ScreenReaderAnnounce message={announcement} />
			<p className="m-0 px-3 pt-1.5 pb-0.5 text-[10px] text-muted-foreground">
				{searchQuery ? "Search results" : "Add context"}
			</p>
			<div
				aria-activedescendant={
					filteredOptions.length > selectedIndex &&
					selectedIndex > -1 &&
					isOptionSelectable(filteredOptions[selectedIndex])
						? `context-menu-item-${selectedIndex}`
						: undefined
				}
				aria-label="Context mentions"
				className="bg-[var(--vscode-dropdown-background)] flex flex-col max-h-[min(160px,28vh)] overflow-y-auto overscroll-contain"
				ref={menuRef}
				role="listbox"
				tabIndex={0}>
				{" "}
				{/* Can't use virtuoso since it requires fixed height and menu height is dynamic based on # of items */}
				{showDelayedLoading && searchQuery && (
					<div className="py-2 px-3 flex items-center gap-2 opacity-70 text-xs">
						<VscIcon className="animate-spin text-sm" name="loading" />
						<span>Searching…</span>
					</div>
				)}
				{filteredOptions.map((option, index) => {
					// Include workspace name in key for files/folders to handle duplicates across workspaces
					const workspacePrefix = option.workspaceName ? `${option.workspaceName}:` : ""
					const generatedKey = `${option.type}-${workspacePrefix}${option.value || index}`

					const isSelected = index === selectedIndex && isOptionSelectable(option)

					return (
						<div
							aria-label={getOptionLabel(option)}
							aria-selected={isSelected}
							className={cn(
								"py-2 px-3 flex items-center justify-between border-b border-editor-group-border",
								isOptionSelectable(option)
									? "cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)]"
									: "cursor-default",
								isSelected &&
									"bg-[var(--vscode-quickInputList-focusBackground)] text-[var(--vscode-quickInputList-focusForeground)]",
							)}
							id={`context-menu-item-${index}`}
							key={generatedKey}
							onClick={() => handleSelect(option)}
							onMouseEnter={() => isOptionSelectable(option) && setSelectedIndex(index)}
							role="option">
							<div className="flex items-center flex-1 min-w-0 overflow-hidden">
								<VscIcon className="mr-2 shrink-0 text-sm" name={getIconForOption(option)} />
								{renderOptionContent(option)}
							</div>
							{(option.type === ContextMenuOptionType.File ||
								option.type === ContextMenuOptionType.Folder ||
								option.type === ContextMenuOptionType.Git) &&
								!option.value && <VscIcon className="text-sm shrink-0 ml-2" name="chevron-right" />}
							{(option.type === ContextMenuOptionType.Problems ||
								option.type === ContextMenuOptionType.Terminal ||
								((option.type === ContextMenuOptionType.File ||
									option.type === ContextMenuOptionType.Folder ||
									option.type === ContextMenuOptionType.Git) &&
									option.value)) && <VscIcon className="text-sm shrink-0 ml-2" name="add" />}
						</div>
					)
				})}
			</div>
		</div>
	)
}

export default ContextMenu
