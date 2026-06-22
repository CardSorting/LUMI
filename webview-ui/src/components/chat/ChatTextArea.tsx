import { mentionRegex } from "@shared/context-mentions"
import { StringRequest } from "@shared/proto/dietcode/common"
import { FileSearchRequest, FileSearchType, RelativePathsRequest } from "@shared/proto/dietcode/file"
import type React from "react"
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import ContextMenu from "@/components/chat/ContextMenu"
import { CHAT_CONSTANTS } from "@/components/chat/chat-view/constants"
import SlashCommandMenu from "@/components/chat/SlashCommandMenu"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { Icon } from "@/components/ui/icons"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import {
	ContextMenuOptionType,
	getContextMenuOptionIndex,
	getContextMenuOptions,
	insertMention,
	insertMentionDirectly,
	removeMention,
	type SearchResult,
	shouldShowContextMenu,
} from "@/utils/context-mentions"
import { isSafari } from "@/utils/platformUtils"
import {
	getMatchingSlashCommands,
	insertSlashCommand,
	removeSlashCommand,
	type SlashCommand,
	shouldShowSlashCommandsMenu,
	slashCommandDeleteRegex,
} from "@/utils/slash-commands"
import { ChatInputActions } from "./ChatInputActions"

const { MAX_IMAGES_AND_FILES_PER_MESSAGE } = CHAT_CONSTANTS

const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => {
			if (img.naturalWidth > 7500 || img.naturalHeight > 7500) {
				reject(new Error("Image dimensions exceed maximum allowed size of 7500px."))
			} else {
				resolve({ width: img.naturalWidth, height: img.naturalHeight })
			}
		}
		img.onerror = (err) => {
			console.error("Failed to load image for dimension check:", err)
			reject(new Error("Failed to load image to check dimensions."))
		}
		img.src = dataUrl
	})
}

// Set to "File" option by default
const DEFAULT_CONTEXT_MENU_OPTION = getContextMenuOptionIndex(ContextMenuOptionType.File)

interface ChatTextAreaProps {
	inputValue: string
	activeQuote: string | null
	setInputValue: (value: string) => void
	sendingDisabled: boolean
	placeholderText: string
	selectedFiles: string[]
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>
	onSend: (value?: string) => void
	onSelectFilesAndImages: () => void
	shouldDisableFilesAndImages: boolean
	onHeightChange?: (height: number) => void
	onFocusChange?: (isFocused: boolean) => void
}

interface GitCommit {
	type: ContextMenuOptionType.Git
	value: string
	label: string
	description: string
}

const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
	(
		{
			inputValue,
			setInputValue,
			sendingDisabled,
			placeholderText,
			selectedFiles,
			selectedImages,
			setSelectedImages,
			setSelectedFiles,
			onSend,
			onSelectFilesAndImages,
			shouldDisableFilesAndImages,
			onHeightChange,
			onFocusChange,
		},
		ref,
	) => {
		const {
			mode,
			apiConfiguration,
			localWorkflowToggles,
			globalWorkflowToggles,
			remoteWorkflowToggles,
			remoteConfigSettings,
			navigateToSettingsModelPicker,
			mcpServers,
		} = useExtensionState()
		const [isDraggingOver, setIsDraggingOver] = useState(false)
		const [isInputFocused, setIsInputFocused] = useState(false)
		const [gitCommits, setGitCommits] = useState<GitCommit[]>([])
		const [showSlashCommandsMenu, setShowSlashCommandsMenu] = useState(false)
		const [selectedSlashCommandsIndex, setSelectedSlashCommandsIndex] = useState(0)
		const [slashCommandsQuery, setSlashCommandsQuery] = useState("")
		const slashCommandsMenuContainerRef = useRef<HTMLDivElement>(null)

		const [showContextMenu, setShowContextMenu] = useState(false)
		const [cursorPosition, setCursorPosition] = useState(0)
		const [searchQuery, setSearchQuery] = useState("")
		const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
		const [isMouseDownOnMenu, setIsMouseDownOnMenu] = useState(false)
		const [selectedMenuIndex, setSelectedMenuIndex] = useState(-1)
		const [selectedType, setSelectedType] = useState<ContextMenuOptionType | null>(null)
		const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false)
		const [justDeletedSpaceAfterSlashCommand, setJustDeletedSpaceAfterSlashCommand] = useState(false)
		const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null)
		const contextMenuContainerRef = useRef<HTMLDivElement>(null)

		const [pendingInsertions, setPendingInsertions] = useState<string[]>([])
		const _shiftHoldTimerRef = useRef<NodeJS.Timeout | null>(null)
		const [showUnsupportedFileError, setShowUnsupportedFileError] = useState(false)
		const unsupportedFileTimerRef = useRef<NodeJS.Timeout | null>(null)
		const [showDimensionError, setShowDimensionError] = useState(false)
		const dimensionErrorTimerRef = useRef<NodeJS.Timeout | null>(null)

		const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])
		const [searchLoading, setSearchLoading] = useState(false)

		// Fetch git commits when Git is selected or when typing a hash
		useEffect(() => {
			if (selectedType === ContextMenuOptionType.Git || /^[a-f0-9]+$/i.test(searchQuery)) {
				FileServiceClient.searchCommits(StringRequest.create({ value: searchQuery || "" }))
					.then((response) => {
						if (response.commits) {
							const commits: GitCommit[] = response.commits.map(
								(commit: { hash: string; shortHash: string; subject: string; author: string; date: string }) => ({
									type: ContextMenuOptionType.Git,
									value: commit.hash,
									label: commit.subject,
									description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
								}),
							)
							setGitCommits(commits)
						}
					})
					.catch((error) => {
						console.error("Error searching commits:", error)
					})
			}
		}, [selectedType, searchQuery])

		const queryItems = useMemo(() => {
			return [
				{ type: ContextMenuOptionType.Problems, value: "problems" },
				{ type: ContextMenuOptionType.Terminal, value: "terminal" },
				...gitCommits,
			]
		}, [gitCommits])

		useEffect(() => {
			const handleClickOutside = (event: MouseEvent) => {
				if (contextMenuContainerRef.current && !contextMenuContainerRef.current.contains(event.target as Node)) {
					setShowContextMenu(false)
				}
			}

			if (showContextMenu) {
				document.addEventListener("mousedown", handleClickOutside)
			}

			return () => {
				document.removeEventListener("mousedown", handleClickOutside)
			}
		}, [showContextMenu])

		useEffect(() => {
			const handleClickOutsideSlashMenu = (event: MouseEvent) => {
				if (
					slashCommandsMenuContainerRef.current &&
					!slashCommandsMenuContainerRef.current.contains(event.target as Node)
				) {
					setShowSlashCommandsMenu(false)
				}
			}

			if (showSlashCommandsMenu) {
				document.addEventListener("mousedown", handleClickOutsideSlashMenu)
			}

			return () => {
				document.removeEventListener("mousedown", handleClickOutsideSlashMenu)
			}
		}, [showSlashCommandsMenu])

		const handleMentionSelect = useCallback(
			(type: ContextMenuOptionType, value?: string) => {
				if (type === ContextMenuOptionType.NoResults) {
					return
				}

				if (
					type === ContextMenuOptionType.File ||
					type === ContextMenuOptionType.Folder ||
					type === ContextMenuOptionType.Git
				) {
					if (!value) {
						setSelectedType(type)
						setSearchQuery("")
						setSelectedMenuIndex(0)

						// Trigger search with the selected type
						if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
							setSearchLoading(true)

							// Map ContextMenuOptionType to FileSearchType enum
							let searchType: FileSearchType | undefined
							if (type === ContextMenuOptionType.File) {
								searchType = FileSearchType.FILE
							} else if (type === ContextMenuOptionType.Folder) {
								searchType = FileSearchType.FOLDER
							}

							FileServiceClient.searchFiles(
								FileSearchRequest.create({
									query: "",
									mentionsRequestId: "",
									selectedType: searchType,
								}),
							)
								.then((results) => {
									setFileSearchResults((results.results || []) as SearchResult[])
									setSearchLoading(false)
								})
								.catch((error) => {
									console.error("Error searching files:", error)
									setFileSearchResults([])
									setSearchLoading(false)
								})
						}
						return
					}
				}

				setShowContextMenu(false)
				setSelectedType(null)
				const queryLength = searchQuery.length
				setSearchQuery("")

				if (textAreaRef.current) {
					let insertValue = value || ""
					if (type === ContextMenuOptionType.URL) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.Problems) {
						insertValue = "problems"
					} else if (type === ContextMenuOptionType.Terminal) {
						insertValue = "terminal"
					} else if (type === ContextMenuOptionType.Git) {
						insertValue = value || ""
					}

					const { newValue, mentionIndex } = insertMention(
						textAreaRef.current.value,
						cursorPosition,
						insertValue,
						queryLength,
					)

					setInputValue(newValue)
					const newCursorPosition = newValue.indexOf(" ", mentionIndex + insertValue.length) + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					// textAreaRef.current.focus()

					// scroll to cursor
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			[setInputValue, cursorPosition, searchQuery],
		)

		const handleSlashCommandsSelect = useCallback(
			(command: SlashCommand) => {
				setShowSlashCommandsMenu(false)
				const queryLength = slashCommandsQuery.length
				setSlashCommandsQuery("")

				if (textAreaRef.current) {
					const { newValue, commandIndex } = insertSlashCommand(
						textAreaRef.current.value,
						command.name,
						queryLength,
						cursorPosition,
					)
					const newCursorPosition = newValue.indexOf(" ", commandIndex + 1 + command.name.length) + 1

					setInputValue(newValue)
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)

					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			[setInputValue, slashCommandsQuery, cursorPosition],
		)

		// Effect to set cursor position after state updates
		useLayoutEffect(() => {
			if (intendedCursorPosition !== null && textAreaRef.current) {
				textAreaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
				setIntendedCursorPosition(null) // Reset the state after applying
			}
		}, [intendedCursorPosition])

		useEffect(() => {
			if (pendingInsertions.length === 0 || !textAreaRef.current) {
				return
			}

			const path = pendingInsertions[0]
			const currentTextArea = textAreaRef.current
			const currentValue = currentTextArea.value
			const currentCursorPos =
				intendedCursorPosition ??
				(currentTextArea.selectionStart >= 0 ? currentTextArea.selectionStart : currentValue.length)

			const { newValue, mentionIndex } = insertMentionDirectly(currentValue, currentCursorPos, path)

			setInputValue(newValue)

			const newCursorPosition = mentionIndex + path.length + 2
			setIntendedCursorPosition(newCursorPosition)

			setPendingInsertions((prev) => prev.slice(1))
		}, [pendingInsertions, setInputValue, intendedCursorPosition])

		const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

		const currentSearchQueryRef = useRef<string>("")

		const handleInputChange = useCallback(
			(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				const newValue = e.target.value
				const newCursorPosition = e.target.selectionStart
				setInputValue(newValue)
				setCursorPosition(newCursorPosition)
				let showMenu = shouldShowContextMenu(newValue, newCursorPosition)
				const showSlashCommandsMenu = shouldShowSlashCommandsMenu(newValue, newCursorPosition)

				// we do not allow both menus to be shown at the same time
				// the slash commands menu has precedence bc its a narrower component
				if (showSlashCommandsMenu) {
					showMenu = false
				}

				setShowSlashCommandsMenu(showSlashCommandsMenu)
				setShowContextMenu(showMenu)

				if (showSlashCommandsMenu) {
					// Find the slash nearest to cursor (before cursor position)
					const beforeCursor = newValue.slice(0, newCursorPosition)
					const slashIndex = beforeCursor.lastIndexOf("/")
					const query = newValue.slice(slashIndex + 1, newCursorPosition)
					setSlashCommandsQuery(query)
					setSelectedSlashCommandsIndex(0)
				} else {
					setSlashCommandsQuery("")
					setSelectedSlashCommandsIndex(0)
				}

				if (showMenu) {
					const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)
					const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
					setSearchQuery(query)
					currentSearchQueryRef.current = query

					if (query.length > 0) {
						setSelectedMenuIndex(0)

						// Clear any existing timeout
						if (searchTimeoutRef.current) {
							clearTimeout(searchTimeoutRef.current)
						}

						setSearchLoading(true)

						const searchType =
							selectedType === ContextMenuOptionType.File
								? FileSearchType.FILE
								: selectedType === ContextMenuOptionType.Folder
									? FileSearchType.FOLDER
									: undefined

						// Parse workspace hint from query (e.g., "@frontend:/filename")
						let workspaceHint: string | undefined
						let searchQuery = query
						const workspaceHintMatch = query.match(/^([\w-]+):\/(.*)$/)
						if (workspaceHintMatch) {
							workspaceHint = workspaceHintMatch[1]
							searchQuery = workspaceHintMatch[2]
						}

						// Set a timeout to debounce the search requests
						searchTimeoutRef.current = setTimeout(() => {
							FileServiceClient.searchFiles(
								FileSearchRequest.create({
									query: searchQuery,
									mentionsRequestId: query,
									selectedType: searchType,
									workspaceHint: workspaceHint,
								}),
							)
								.then((results) => {
									setFileSearchResults((results.results || []) as SearchResult[])
									setSearchLoading(false)
								})
								.catch((error) => {
									console.error("Error searching files:", error)
									setFileSearchResults([])
									setSearchLoading(false)
								})
						}, 200) // 200ms debounce
					} else {
						setSelectedMenuIndex(DEFAULT_CONTEXT_MENU_OPTION)
					}
				} else {
					setSearchQuery("")
					setSelectedMenuIndex(-1)
					setFileSearchResults([])
				}
			},
			[setInputValue, selectedType],
		)

		useEffect(() => {
			if (!showContextMenu) {
				setSelectedType(null)
			}
		}, [showContextMenu])

		const handleBlur = useCallback(() => {
			// Only hide the context menu if the user didn't click on it
			if (!isMouseDownOnMenu) {
				setShowContextMenu(false)
				setShowSlashCommandsMenu(false)
			}
			onFocusChange?.(false)
			setIsInputFocused(false)
		}, [isMouseDownOnMenu, onFocusChange])

		const showDimensionErrorMessage = useCallback(() => {
			setShowDimensionError(true)
			if (dimensionErrorTimerRef.current) {
				clearTimeout(dimensionErrorTimerRef.current)
			}
			dimensionErrorTimerRef.current = setTimeout(() => {
				setShowDimensionError(false)
				dimensionErrorTimerRef.current = null
			}, 3000)
		}, [])

		const handlePaste = useCallback(
			async (e: React.ClipboardEvent) => {
				const items = e.clipboardData.items

				const pastedText = e.clipboardData.getData("text")
				// Check if the pasted content is a URL, add space after so user can easily delete if they don't want it
				const urlRegex = /^\S+:\/\/\S+$/
				if (urlRegex.test(pastedText.trim())) {
					e.preventDefault()
					const trimmedUrl = pastedText.trim()
					const newValue = `${inputValue.slice(0, cursorPosition) + trimmedUrl} ${inputValue.slice(cursorPosition)}`
					setInputValue(newValue)
					const newCursorPosition = cursorPosition + trimmedUrl.length + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					setShowContextMenu(false)

					// Scroll to new cursor position
					// https://stackoverflow.com/questions/29899364/how-do-you-scroll-to-the-position-of-the-cursor-in-a-textarea/40951875#40951875
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
					// NOTE: callbacks dont utilize return function to cleanup, but it's fine since this timeout immediately executes and will be cleaned up by the browser (no chance component unmounts before it executes)

					return
				}

				const acceptedTypes = ["png", "jpeg", "webp"] // supported by anthropic and openrouter (jpg is just a file extension but the image will be recognized as jpeg)
				const imageItems = Array.from(items).filter((item) => {
					const [type, subtype] = item.type.split("/")
					return type === "image" && acceptedTypes.includes(subtype)
				})
				if (!shouldDisableFilesAndImages && imageItems.length > 0) {
					e.preventDefault()
					const imagePromises = imageItems.map((item) => {
						return new Promise<string | null>((resolve) => {
							const blob = item.getAsFile()
							if (!blob) {
								resolve(null)
								return
							}
							const reader = new FileReader()
							reader.onloadend = async () => {
								if (reader.error) {
									console.error("Error reading file:", reader.error)
									resolve(null)
								} else {
									const result = reader.result
									if (typeof result === "string") {
										try {
											await getImageDimensions(result)
											resolve(result)
										} catch (error) {
											console.warn((error as Error).message)
											showDimensionErrorMessage()
											resolve(null)
										}
									} else {
										resolve(null)
									}
								}
							}
							reader.readAsDataURL(blob)
						})
					})
					const imageDataArray = await Promise.all(imagePromises)
					const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)
					//.map((dataUrl) => dataUrl.split(",")[1]) // strip the mime type prefix, sharp doesn't need it
					if (dataUrls.length > 0) {
						const filesAndImagesLength = selectedImages.length + selectedFiles.length
						const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - filesAndImagesLength

						if (availableSlots > 0) {
							const imagesToAdd = Math.min(dataUrls.length, availableSlots)
							setSelectedImages((prevImages) => [...prevImages, ...dataUrls.slice(0, imagesToAdd)])
						}
					} else {
						console.warn("No valid images were processed")
					}
				}
			},
			[
				shouldDisableFilesAndImages,
				setSelectedImages,
				selectedImages,
				selectedFiles,
				cursorPosition,
				setInputValue,
				inputValue,
				showDimensionErrorMessage,
			],
		)

		const handleMenuMouseDown = useCallback(() => {
			setIsMouseDownOnMenu(true)
		}, [])

		const updateCursorPosition = useCallback(() => {
			if (textAreaRef.current) {
				setCursorPosition(textAreaRef.current.selectionStart)
			}
		}, [])

		const handleKeyUp = useCallback(
			(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
					updateCursorPosition()
				}
			},
			[updateCursorPosition],
		)

		const handleContextButtonClick = useCallback(() => {
			// Focus the textarea first
			textAreaRef.current?.focus()

			// If input is empty, just insert @
			if (!inputValue.trim()) {
				const event = {
					target: {
						value: "@",
						selectionStart: 1,
					},
				} as React.ChangeEvent<HTMLTextAreaElement>
				handleInputChange(event)
				return
			}

			// If input ends with space or is empty, just append @
			if (inputValue.endsWith(" ")) {
				const event = {
					target: {
						value: `${inputValue}@`,
						selectionStart: inputValue.length + 1,
					},
				} as React.ChangeEvent<HTMLTextAreaElement>
				handleInputChange(event)
				return
			}

			// Otherwise add space then @
			const event = {
				target: {
					value: `${inputValue} @`,
					selectionStart: inputValue.length + 2,
				},
			} as React.ChangeEvent<HTMLTextAreaElement>
			handleInputChange(event)
		}, [inputValue, handleInputChange])

		const handleModelButtonClick = () => {
			navigateToSettingsModelPicker({ targetSection: "api-config" })
		}

		// Get model display name
		const modelDisplayName = useMemo(() => {
			const { selectedProvider, selectedModelId } = normalizeApiConfiguration(apiConfiguration, mode)
			const { openRouterModelId } = getModeSpecificFields(apiConfiguration, mode)

			if (!apiConfiguration) {
				return "unknown"
			}

			switch (selectedProvider) {
				case "openrouter":
					return `${selectedProvider}:${openRouterModelId || selectedModelId}`
				default:
					return `${selectedProvider}:${selectedModelId}`
			}
		}, [apiConfiguration, mode])

		// Function to show error message for unsupported files for drag and drop
		const showUnsupportedFileErrorMessage = () => {
			// Show error message for unsupported files
			setShowUnsupportedFileError(true)

			// Clear any existing timer
			if (unsupportedFileTimerRef.current) {
				clearTimeout(unsupportedFileTimerRef.current)
			}

			// Set timer to hide error after 3 seconds
			unsupportedFileTimerRef.current = setTimeout(() => {
				setShowUnsupportedFileError(false)
				unsupportedFileTimerRef.current = null
			}, 3000)
		}

		const handleDragEnter = (e: React.DragEvent) => {
			e.preventDefault()
			setIsDraggingOver(true)

			// Check if files are being dragged
			if (e.dataTransfer.types.includes("Files")) {
				// Check if any of the files are not images
				const items = Array.from(e.dataTransfer.items)
				const hasNonImageFile = items.some((item) => {
					if (item.kind === "file") {
						const type = item.type.split("/")[0]
						return type !== "image"
					}
					return false
				})

				if (hasNonImageFile) {
					showUnsupportedFileErrorMessage()
				}
			}
		}
		/**
		 * Handles the drag over event to allow dropping.
		 * Prevents the default behavior to enable drop.
		 *
		 * @param {React.DragEvent} e - The drag event.
		 */
		const onDragOver = (e: React.DragEvent) => {
			e.preventDefault()
			// Ensure state remains true if dragging continues over the element
			if (!isDraggingOver) {
				setIsDraggingOver(true)
			}
		}

		const handleDragLeave = (e: React.DragEvent) => {
			e.preventDefault()
			// Check if the related target is still within the drop zone; prevents flickering
			const dropZone = e.currentTarget as HTMLElement
			if (!dropZone.contains(e.relatedTarget as Node)) {
				setIsDraggingOver(false)
				// Don't clear the error message here, let it time out naturally
			}
		}

		// Effect to detect when drag operation ends outside the component
		useEffect(() => {
			const handleGlobalDragEnd = () => {
				// This will be triggered when the drag operation ends anywhere
				setIsDraggingOver(false)
				// Don't clear error message, let it time out naturally
			}

			document.addEventListener("dragend", handleGlobalDragEnd)

			return () => {
				document.removeEventListener("dragend", handleGlobalDragEnd)
			}
		}, [])

		/**
		 * Handles the drop event for files and text.
		 * Processes dropped images and text, updating the state accordingly.
		 *
		 * @param {React.DragEvent} e - The drop event.
		 */
		const onDrop = async (e: React.DragEvent) => {
			e.preventDefault()
			setIsDraggingOver(false) // Reset state on drop

			// Clear any error message when something is actually dropped
			setShowUnsupportedFileError(false)
			if (unsupportedFileTimerRef.current) {
				clearTimeout(unsupportedFileTimerRef.current)
				unsupportedFileTimerRef.current = null
			}

			// --- 1. VSCode Explorer Drop Handling ---
			let uris: string[] = []
			const resourceUrlsData = e.dataTransfer.getData("resourceurls")
			const vscodeUriListData = e.dataTransfer.getData("application/vnd.code.uri-list")

			// 1a. Try 'resourceurls' first (used for multi-select)
			if (resourceUrlsData) {
				try {
					uris = JSON.parse(resourceUrlsData)
					uris = uris.map((uri) => decodeURIComponent(uri))
				} catch (error) {
					console.error("Failed to parse resourceurls JSON:", error)
					uris = [] // Reset if parsing failed
				}
			}

			// 1b. Fallback to 'application/vnd.code.uri-list' (newline separated)
			if (uris.length === 0 && vscodeUriListData) {
				uris = vscodeUriListData.split("\n").map((uri) => uri.trim())
			}

			// 1c. Filter for valid schemes (file or vscode-file) and non-empty strings
			const validUris = uris.filter(
				(uri) => uri && (uri.startsWith("vscode-file:") || uri.startsWith("file:") || uri.startsWith("vscode-remote:")),
			)

			if (validUris.length > 0) {
				setPendingInsertions([])
				let initialCursorPos = inputValue.length
				if (textAreaRef.current) {
					initialCursorPos = textAreaRef.current.selectionStart
				}
				setIntendedCursorPosition(initialCursorPos)

				FileServiceClient.getRelativePaths(RelativePathsRequest.create({ uris: validUris }))
					.then((response) => {
						if (response.paths.length > 0) {
							setPendingInsertions((prev) => [...prev, ...response.paths])
						}
					})
					.catch((error) => {
						console.error("Error getting relative paths:", error)
					})
				return
			}

			const text = e.dataTransfer.getData("text")
			if (text) {
				handleTextDrop(text)
				return
			}

			// --- 3. Image Drop Handling ---
			// Only proceed if it wasn't a VSCode resource or plain text drop
			const files = Array.from(e.dataTransfer.files)
			const acceptedTypes = ["png", "jpeg", "webp"]
			const imageFiles = files.filter((file) => {
				const [type, subtype] = file.type.split("/")
				return type === "image" && acceptedTypes.includes(subtype)
			})

			if (shouldDisableFilesAndImages || imageFiles.length === 0) {
				return
			}

			const imageDataArray = await readImageFiles(imageFiles)
			const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

			if (dataUrls.length > 0) {
				const filesAndImagesLength = selectedImages.length + selectedFiles.length
				const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - filesAndImagesLength

				if (availableSlots > 0) {
					const imagesToAdd = Math.min(dataUrls.length, availableSlots)
					setSelectedImages((prevImages) => [...prevImages, ...dataUrls.slice(0, imagesToAdd)])
				}
			} else {
				console.warn("No valid images were processed")
			}
		}

		/**
		 * Handles the drop event for text.
		 * Inserts the dropped text at the current cursor position.
		 *
		 * @param {string} text - The dropped text.
		 */
		const handleTextDrop = (text: string) => {
			const newValue = inputValue.slice(0, cursorPosition) + text + inputValue.slice(cursorPosition)
			setInputValue(newValue)
			const newCursorPosition = cursorPosition + text.length
			setCursorPosition(newCursorPosition)
			setIntendedCursorPosition(newCursorPosition)
		}

		/**
		 * Reads image files and returns their data URLs.
		 * Uses FileReader to read the files as data URLs.
		 *
		 * @param {File[]} imageFiles - The image files to read.
		 * @returns {Promise<(string | null)[]>} - A promise that resolves to an array of data URLs or null values.
		 */
		const readImageFiles = (imageFiles: File[]): Promise<(string | null)[]> => {
			return Promise.all(
				imageFiles.map(
					(file) =>
						new Promise<string | null>((resolve) => {
							const reader = new FileReader()
							reader.onloadend = async () => {
								// Make async
								if (reader.error) {
									console.error("Error reading file:", reader.error)
									resolve(null)
								} else {
									const result = reader.result
									if (typeof result === "string") {
										try {
											await getImageDimensions(result) // Check dimensions
											resolve(result)
										} catch (error) {
											console.warn((error as Error).message)
											showDimensionErrorMessage() // Show error to user
											resolve(null) // Don't add this image
										}
									} else {
										resolve(null)
									}
								}
							}
							reader.readAsDataURL(file)
						}),
				),
			)
		}

		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				const isSelectAllShortcut =
					(event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a"
				if (isSelectAllShortcut) {
					event.preventDefault()
					event.stopPropagation()
					const textArea = event.currentTarget
					textArea.setSelectionRange(0, textArea.value.length)
					setCursorPosition(0)
					return
				}

				if (showSlashCommandsMenu) {
					if (event.key === "Escape") {
						setShowSlashCommandsMenu(false)
						setSlashCommandsQuery("")
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedSlashCommandsIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							// Get commands with workflow toggles
							const allCommands = getMatchingSlashCommands(
								slashCommandsQuery,
								localWorkflowToggles,
								globalWorkflowToggles,
								remoteWorkflowToggles,
								remoteConfigSettings?.remoteGlobalWorkflows,
								mcpServers,
							)

							if (allCommands.length === 0) {
								return prevIndex
							}

							// Calculate total command count
							const totalCommandCount = allCommands.length

							// Create wraparound navigation - moves from last item to first and vice versa
							const newIndex = (prevIndex + direction + totalCommandCount) % totalCommandCount
							return newIndex
						})
						return
					}

					if ((event.key === "Enter" || event.key === "Tab") && selectedSlashCommandsIndex !== -1) {
						event.preventDefault()
						const commands = getMatchingSlashCommands(
							slashCommandsQuery,
							localWorkflowToggles,
							globalWorkflowToggles,
							remoteWorkflowToggles,
							remoteConfigSettings?.remoteGlobalWorkflows,
							mcpServers,
						)
						if (commands.length > 0) {
							handleSlashCommandsSelect(commands[selectedSlashCommandsIndex])
						}
						return
					}
				}
				if (showContextMenu) {
					if (event.key === "Escape") {
						setShowContextMenu(false)
						setSelectedType(null)
						setSelectedMenuIndex(DEFAULT_CONTEXT_MENU_OPTION)
						setSearchQuery("")
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedMenuIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							const options = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)
							const optionsLength = options.length

							if (optionsLength === 0) {
								return prevIndex
							}

							// Find selectable options (non-URL types)
							const selectableOptions = options.filter(
								(option) =>
									option.type !== ContextMenuOptionType.URL && option.type !== ContextMenuOptionType.NoResults,
							)

							if (selectableOptions.length === 0) {
								return -1 // No selectable options
							}

							// Find the index of the next selectable option
							const currentSelectableIndex = selectableOptions.indexOf(options[prevIndex])

							const newSelectableIndex =
								(currentSelectableIndex + direction + selectableOptions.length) % selectableOptions.length

							// Find the index of the selected option in the original options array
							return options.indexOf(selectableOptions[newSelectableIndex])
						})
						return
					}
					if ((event.key === "Enter" || event.key === "Tab") && selectedMenuIndex !== -1) {
						event.preventDefault()
						const selectedOption = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)[
							selectedMenuIndex
						]
						if (
							selectedOption &&
							selectedOption.type !== ContextMenuOptionType.URL &&
							selectedOption.type !== ContextMenuOptionType.NoResults
						) {
							// Use label if it contains workspace prefix, otherwise use value
							const mentionValue = selectedOption.label?.includes(":") ? selectedOption.label : selectedOption.value
							handleMentionSelect(selectedOption.type, mentionValue)
						}
						return
					}
				}

				// Safari does not support InputEvent.isComposing (always false), so we need to fallback to keyCode === 229 for it
				const isComposing = isSafari ? event.nativeEvent.keyCode === 229 : (event.nativeEvent?.isComposing ?? false)
				if (event.key === "Enter" && !event.shiftKey && !isComposing) {
					event.preventDefault()

					if (!sendingDisabled) {
						onSend()
					}
				}

				if (event.key === "Backspace" && !isComposing) {
					const charBeforeCursor = inputValue[cursorPosition - 1]
					const charAfterCursor = inputValue[cursorPosition + 1]

					const charBeforeIsWhitespace =
						charBeforeCursor === " " || charBeforeCursor === "\n" || charBeforeCursor === "\r\n"
					const charAfterIsWhitespace =
						charAfterCursor === " " || charAfterCursor === "\n" || charAfterCursor === "\r\n"

					// Check if we're right after a space that follows a mention or slash command
					if (
						charBeforeIsWhitespace &&
						inputValue.slice(0, cursorPosition - 1).match(new RegExp(`${mentionRegex.source}$`))
					) {
						// File mention handling
						const newCursorPosition = cursorPosition - 1
						if (!charAfterIsWhitespace) {
							event.preventDefault()
							textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
							setCursorPosition(newCursorPosition)
						}
						setCursorPosition(newCursorPosition)
						setJustDeletedSpaceAfterMention(true)
						setJustDeletedSpaceAfterSlashCommand(false)
					} else if (charBeforeIsWhitespace && inputValue.slice(0, cursorPosition - 1).match(slashCommandDeleteRegex)) {
						// New slash command handling
						const newCursorPosition = cursorPosition - 1
						if (!charAfterIsWhitespace) {
							event.preventDefault()
							textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
							setCursorPosition(newCursorPosition)
						}
						setCursorPosition(newCursorPosition)
						setJustDeletedSpaceAfterSlashCommand(true)
						setJustDeletedSpaceAfterMention(false)
					}
					// Handle the second backspace press for mentions or slash commands
					else if (justDeletedSpaceAfterMention) {
						const { newText, newPosition } = removeMention(inputValue, cursorPosition)
						if (newText !== inputValue) {
							event.preventDefault()
							setInputValue(newText)
							setIntendedCursorPosition(newPosition)
						}
						setJustDeletedSpaceAfterMention(false)
						setShowContextMenu(false)
					} else if (justDeletedSpaceAfterSlashCommand) {
						// New slash command deletion
						const { newText, newPosition } = removeSlashCommand(inputValue, cursorPosition)
						if (newText !== inputValue) {
							event.preventDefault()
							setInputValue(newText)
							setIntendedCursorPosition(newPosition)
						}
						setJustDeletedSpaceAfterSlashCommand(false)
						setShowSlashCommandsMenu(false)
					}
					// Default case - reset flags if none of the above apply
					else {
						setJustDeletedSpaceAfterMention(false)
						setJustDeletedSpaceAfterSlashCommand(false)
					}
				}
			},
			[
				onSend,
				showContextMenu,
				searchQuery,
				selectedMenuIndex,
				handleMentionSelect,
				selectedType,
				inputValue,
				cursorPosition,
				setInputValue,
				justDeletedSpaceAfterMention,
				queryItems,
				fileSearchResults,
				showSlashCommandsMenu,
				selectedSlashCommandsIndex,
				slashCommandsQuery,
				handleSlashCommandsSelect,
				sendingDisabled,
				globalWorkflowToggles,
				justDeletedSpaceAfterSlashCommand,
				localWorkflowToggles,
				mcpServers,
				remoteConfigSettings?.remoteGlobalWorkflows,
				remoteWorkflowToggles,
			],
		)

		return (
			<div>
				<div
					className="px-2.5 pt-1.5 pb-1.5 flex flex-col gap-1.5"
					onDragEnter={handleDragEnter}
					onDragLeave={handleDragLeave}
					onDragOver={onDragOver}
					onDrop={onDrop}
					role="presentation">
					<div
						className={cn(
							"chat-input-shell relative rounded-xl border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] transition-shadow",
							isDraggingOver &&
								!showUnsupportedFileError &&
								"ring-2 ring-[var(--vscode-focusBorder)] border-transparent",
							isInputFocused &&
								"border-[color-mix(in_srgb,var(--vscode-focusBorder)_45%,var(--vscode-input-border))]",
						)}>
						{showDimensionError && (
							<div className="mx-3 mt-2 px-2 py-1 text-error text-xs border border-error rounded-md">
								Image dimensions exceed 7500px
							</div>
						)}
						{showUnsupportedFileError && (
							<div className="mx-3 mt-2 px-2 py-1 text-error text-xs border border-error rounded-md">
								Files other than images are currently disabled
							</div>
						)}
						{showSlashCommandsMenu && (
							<div className="px-1" ref={slashCommandsMenuContainerRef}>
								<SlashCommandMenu
									globalWorkflowToggles={globalWorkflowToggles}
									localWorkflowToggles={localWorkflowToggles}
									mcpServers={mcpServers}
									onMouseDown={handleMenuMouseDown}
									onSelect={handleSlashCommandsSelect}
									query={slashCommandsQuery}
									remoteWorkflows={remoteConfigSettings?.remoteGlobalWorkflows}
									remoteWorkflowToggles={remoteWorkflowToggles}
									selectedIndex={selectedSlashCommandsIndex}
									setSelectedIndex={setSelectedSlashCommandsIndex}
								/>
							</div>
						)}

						{showContextMenu && (
							<div className="px-1" ref={contextMenuContainerRef}>
								<ContextMenu
									dynamicSearchResults={fileSearchResults}
									isLoading={searchLoading}
									onMouseDown={handleMenuMouseDown}
									onSelect={handleMentionSelect}
									queryItems={queryItems}
									searchQuery={searchQuery}
									selectedIndex={selectedMenuIndex}
									selectedType={selectedType}
									setSelectedIndex={setSelectedMenuIndex}
								/>
							</div>
						)}
						<div className="flex items-end gap-1.5 px-2 py-1.5 min-w-0">
							<DynamicTextArea
								autoFocus={true}
								className={cn(
									"chat-input-textarea flex-1 min-w-0 resize-none border-0 bg-transparent shadow-none focus:outline-none focus:ring-0",
									showContextMenu || showSlashCommandsMenu ? "min-h-[40px]" : "min-h-[48px]",
									"px-1 py-0.5",
								)}
								data-testid="chat-input"
								maxRows={8}
								minRows={1}
								onBlur={handleBlur}
								onChange={handleInputChange}
								onFocus={() => {
									setIsInputFocused(true)
									onFocusChange?.(true)
								}}
								onHeightChange={onHeightChange}
								onKeyDown={handleKeyDown}
								onKeyUp={handleKeyUp}
								onMouseUp={updateCursorPosition}
								onPaste={handlePaste}
								onSelect={updateCursorPosition}
								placeholder={showUnsupportedFileError || showDimensionError ? "" : placeholderText}
								ref={(el) => {
									if (typeof ref === "function") {
										ref(el)
									} else if (ref) {
										ref.current = el
									}
									textAreaRef.current = el
								}}
								value={inputValue}
							/>
							<button
								aria-label="Send message"
								className={cn(
									"flex items-center justify-center size-8 shrink-0 rounded-full transition-colors mb-0.5",
									sendingDisabled
										? "opacity-40 cursor-not-allowed text-muted-foreground"
										: "bg-lumi text-lumi-foreground hover:opacity-90 cursor-pointer",
								)}
								data-testid="send-button"
								disabled={sendingDisabled}
								onClick={() => {
									if (!sendingDisabled) {
										onSend()
									}
								}}
								title="Send (Enter)"
								type="button">
								<Icon className="[svg]:size-4" name="send" size={16} />
							</button>
						</div>
					</div>
					{(selectedImages.length > 0 || selectedFiles.length > 0) && (
						<Thumbnails
							files={selectedFiles}
							images={selectedImages}
							setFiles={setSelectedFiles}
							setImages={setSelectedImages}
						/>
					)}
				</div>
				<div className="px-2.5 pb-1.5">
					<ChatInputActions
						attachDisabled={shouldDisableFilesAndImages}
						modelDisplayName={modelDisplayName}
						onAttachClick={() => {
							if (!shouldDisableFilesAndImages) {
								onSelectFilesAndImages()
							}
						}}
						onContextClick={handleContextButtonClick}
						onModelClick={handleModelButtonClick}
					/>
				</div>
			</div>
		)
	},
)

export default ChatTextArea
