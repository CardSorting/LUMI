import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Views - can set up API keys via Settings from Chat", async ({ sidebar, helper }) => {
	await expect(sidebar.getByTestId("chat-input")).toBeVisible({ timeout: 15000 })

	await helper.configureApiKey(sidebar)

	await expect(sidebar.getByTestId("provider-selector-input")).not.toBeVisible()
	await expect(sidebar.getByTestId("chat-input")).toBeVisible()

	const dialog = sidebar.getByRole("heading", {
		name: /^🎉 New in v\d/,
	})
	if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
		await sidebar.getByRole("button", { name: "Close" }).click()
		await expect(dialog).not.toBeVisible()
	}

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
