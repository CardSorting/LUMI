import type { Page } from "@playwright/test"

export const openTab = async (_page: Page, tabName: string) => {
	await _page
		.getByRole("tab", { name: new RegExp(`${tabName}`) })
		.locator("a")
		.click()
}

export const addSelectedCodeToDietCodeWebview = async (_page: Page) => {
	// Focus the active editor and select all content.
	await _page.locator(".monaco-editor").first().click()
	await _page.keyboard.press("ControlOrMeta+a")
	// lumi.addToChat is bound to ctrl+' / cmd+' when editorHasSelection (not in command palette).
	await _page.keyboard.press("ControlOrMeta+'")
}

export const toggleNotifications = async (_page: Page) => {
	await _page.waitForLoadState("domcontentloaded")
	await _page.keyboard.press("ControlOrMeta+Shift+p")
	const editorSearchBar = _page.getByRole("textbox")
	if (!editorSearchBar.isVisible()) {
		await _page.keyboard.press("ControlOrMeta+Shift+p")
	}
	await editorSearchBar.click({ delay: 100 }) // Ensure focus
	await editorSearchBar.fill("> Toggle Do Not Disturb Mode")
	await _page.keyboard.press("Enter")
	return _page
}
