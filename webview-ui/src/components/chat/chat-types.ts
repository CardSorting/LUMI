/**
 * Shared chat component types.
 *
 * NOTE: This leaf module holds types shared between ChatRow and its child rows
 * (e.g. CompletionOutputRow) so children can import them without importing the
 * heavyweight ChatRow component — which imports the children back, forming a
 * cycle. ChatRow re-exports for backward compatibility.
 */

export interface QuoteButtonState {
	visible: boolean
	top: number
	left: number
	selectedText: string
}
