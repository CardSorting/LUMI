import type { Page } from "@playwright/test"

export const openTab = async (_page: Page, tabName: string) => {
	await _page
		.getByRole("tab", { name: new RegExp(`${tabName}`) })
		.locator("a")
		.click()
}

export const addSelectedCodeToDietCodeWebview = async (page: Page) => {
	const editor = page.locator(".monaco-editor").first()
	await editor.click()
	await page.keyboard.press("ControlOrMeta+a")

	// Prefer the keybinding on macOS/Windows; context menu is more reliable on headless Linux CI.
	if (process.platform !== "linux") {
		await page.keyboard.press("ControlOrMeta+'")
		return
	}

	try {
		await editor.click({ button: "right" })
		await page.getByRole("menuitem", { name: "Add to LUMI" }).click({ timeout: 10_000 })
	} catch {
		await editor.click()
		await page.keyboard.press("ControlOrMeta+'")
	}
}

export const toggleNotifications = async (_page: Page) => {
	try {
		await _page.waitForLoadState("domcontentloaded")
		await _page.keyboard.press("ControlOrMeta+Shift+p")
		const editorSearchBar = _page.getByRole("textbox").first()
		await editorSearchBar.click({ delay: 100, timeout: 5000 })
		await editorSearchBar.fill("> Toggle Do Not Disturb Mode", { timeout: 5000 })
		await _page.keyboard.press("Enter")
	} catch {
		// Non-fatal: notification toasts should not fail editor panel tests.
	}
}
