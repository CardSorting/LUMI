import { CodemarieMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import CreditLimitError from "@/components/chat/CreditLimitError"
import { Button } from "@/components/ui/button"
import { useCodemarieAuth, useCodemarieSignIn } from "@/context/CodemarieAuthContext"
import { CodemarieError, CodemarieErrorType } from "../../../../src/services/error/CodemarieError"

const _errorColor = "var(--vscode-errorForeground)"

interface ErrorRowProps {
	message: CodemarieMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "codemarieignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
}

const ErrorRow = memo(({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage }: ErrorRowProps) => {
	const { codemarieUser } = useCodemarieAuth()
	const rawApiError = apiRequestFailedMessage || apiReqStreamingFailedMessage

	const { isLoginLoading, handleSignIn } = useCodemarieSignIn()

	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
				// Handle API request errors with special error parsing
				if (rawApiError) {
					// FIXME: CodemarieError parsing should not be applied to non-Codemarie providers, but it seems we're using codemarieErrorMessage below in the default error display
					const codemarieError = CodemarieError.parse(rawApiError)
					const errorMessage = codemarieError?._error?.message || codemarieError?.message || rawApiError
					const requestId = codemarieError?._error?.request_id
					const providerId = codemarieError?.providerId || codemarieError?._error?.providerId
					const isCodemarieProvider = providerId === "codemarie"
					const errorCode = codemarieError?._error?.code

					if (codemarieError?.isErrorType(CodemarieErrorType.Balance)) {
						const errorDetails = codemarieError._error?.details
						return (
							<CreditLimitError
								buyCreditsUrl={errorDetails?.buy_credits_url}
								currentBalance={errorDetails?.current_balance}
								message={errorDetails?.message}
								totalPromotions={errorDetails?.total_promotions}
								totalSpent={errorDetails?.total_spent}
							/>
						)
					}

					if (codemarieError?.isErrorType(CodemarieErrorType.RateLimit)) {
						return (
							<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">
								{errorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</p>
						)
					}

					return (
						<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere flex flex-col gap-3">
							{/* Display the well-formatted error extracted from the CodemarieError instance */}

							<header>
								{providerId && <span className="uppercase">[{providerId}] </span>}
								{errorCode && <span>{errorCode}</span>}
								{errorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</header>

							{/* Windows Powershell Issue */}
							{errorMessage?.toLowerCase()?.includes("powershell") && (
								<div>
									It seems like you're having Windows PowerShell issues, please see this{" "}
									<a
										className="underline text-inherit"
										href="https://github.com/codemarie/codemarie/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22">
										troubleshooting guide
									</a>
									.
								</div>
							)}

							{/* Display raw API error if different from parsed error message */}
							{errorMessage !== rawApiError && <div>{rawApiError}</div>}

							{/* Display Login button for non-logged in users using the Codemarie provider */}
							<div>
								{/* The user is signed in or not using codemarie provider */}
								{isCodemarieProvider && !codemarieUser ? (
									<Button className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
										Sign in to Codemarie
										{isLoginLoading && (
											<span className="ml-1 animate-spin">
												<span className="codicon codicon-refresh" />
											</span>
										)}
									</Button>
								) : (
									<span className="mb-4 text-description">(Click "Retry" below)</span>
								)}
							</div>
						</p>
					)
				}

				// Regular error message
				return <p className="m-0 mt-0 whitespace-pre-wrap text-error wrap-anywhere">{message.text}</p>

			case "diff_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>The model used search patterns that don't match anything in the file. Retrying...</div>
					</div>
				)

			case "codemarieignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>
							Codemarie tried to access <code>{message.text}</code> which is blocked by the{" "}
							<code>.codemarieignore</code>
							file.
						</div>
					</div>
				)

			default:
				return null
		}
	}

	// For diff_error and codemarieignore_error, we don't show the header separately
	if (errorType === "diff_error" || errorType === "codemarieignore_error") {
		return renderErrorContent()
	}

	// For other error types, show header + content
	return renderErrorContent()
})

export default ErrorRow
