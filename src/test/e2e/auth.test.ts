import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

// Test for setting up API keys
e2e("Views - can set up API keys and navigate to Settings from Chat", async ({ sidebar }) => {
	await expect(sidebar.getByRole("heading", { name: "Hi, I'm LUMI" })).toBeVisible()
	await expect(sidebar.getByRole("button", { name: "Use your own API key" })).toBeVisible()

	await sidebar.getByRole("button", { name: "Use your own API key" }).click()

	const providerSelectorInput = sidebar.getByTestId("provider-selector-input")
	await expect(providerSelectorInput).toBeVisible()

	await providerSelectorInput.click({ delay: 100 })
	await expect(sidebar.getByTestId("provider-option-openrouter")).toBeVisible()
	await sidebar.getByTestId("provider-option-openrouter").click({ delay: 100 })

	const apiKeyInput = sidebar.getByRole("textbox", {
		name: "OpenRouter API Key",
	})
	await apiKeyInput.fill("test-api-key")
	await expect(apiKeyInput).toHaveValue("test-api-key")
	await sidebar.getByRole("button", { name: "Let's go!" }).click()

	await expect(sidebar.getByRole("heading", { name: "Hi, I'm LUMI" })).not.toBeVisible()
	await expect(apiKeyInput).not.toBeVisible()
	await expect(providerSelectorInput).not.toBeVisible()

	const dialog = sidebar.getByRole("heading", {
		name: /^🎉 New in v\d/,
	})
	if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
		await sidebar.getByRole("button", { name: "Close" }).click()
		await expect(dialog).not.toBeVisible()
	}

	const chatInputBox = sidebar.getByTestId("chat-input")
	await expect(chatInputBox).toBeVisible()

	const announcementsRegion = sidebar.locator('[aria-label="Announcements"]')
	if (await announcementsRegion.isVisible({ timeout: 3000 }).catch(() => false)) {
		const pageIndicator = announcementsRegion
			.locator("div")
			.filter({ hasText: /^\d+ \/ \d+$/ })
			.first()
		await expect(pageIndicator).toBeVisible()

		const initialIndicator = (await pageIndicator.innerText()).trim()
		const totalBanners = Number(initialIndicator.split("/")[1]?.trim() || "0")

		if (totalBanners > 1) {
			await sidebar.getByRole("button", { name: "Next banner" }).click()
			await expect(pageIndicator).not.toHaveText(initialIndicator)
			await sidebar.getByRole("button", { name: "Previous banner" }).click()
			await expect(pageIndicator).toHaveText(initialIndicator)
		}
	}
})
