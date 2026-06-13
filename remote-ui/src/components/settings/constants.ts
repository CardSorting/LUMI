import styled from "styled-components"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "./OpenRouterModelPicker"

/**
 * Shared layout constants for settings components.
 *
 * NOTE: These constants live in their own leaf module so provider sub-components
 * can import them without depending on the heavyweight ApiOptions barrel — which
 * imports every provider component back, forming a circular dependency.
 * ApiOptions re-exports for backward compat.
 */

// This is necessary to ensure dropdown opens downward, important for when this is used in a popup.
// Higher than the OpenRouterModelPicker's and ModelSelectorTooltip's z-index.
export const DROPDOWN_Z_INDEX = OPENROUTER_MODEL_PICKER_Z_INDEX + 2

export const DropdownContainer = styled.div<{ zIndex?: number }>`
	position: relative;
	z-index: ${(props) => props.zIndex || DROPDOWN_Z_INDEX};

	// Force dropdowns to open downward
	& vscode-dropdown::part(listbox) {
		position: absolute !important;
		top: 100% !important;
		bottom: auto !important;
	}
`
