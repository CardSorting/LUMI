import os
import re

IGNORE_TEXT = "// biome-ignore lint/suspicious/noConsole: No Logger service available in remote-ui"
FILES = [
    "remote-ui/src/App.tsx",
    "remote-ui/src/main.tsx",
    "remote-ui/src/context/CodemarieAuthContext.tsx",
    "remote-ui/src/context/ExtensionStateContext.tsx",
    "remote-ui/src/App.stories.tsx",
    "remote-ui/src/config/platform.config.ts",
    "remote-ui/src/utils/getLanguageFromPath.ts",
    "remote-ui/src/components/ui/hooks/useOpenRouterKeyInfo.ts",
    "remote-ui/src/components/settings/GroqModelPicker.tsx",
    "remote-ui/src/components/settings/sections/TerminalSettingsSection.tsx",
    "remote-ui/src/components/settings/sections/BrowserSettingsSection.tsx",
    "remote-ui/src/components/settings/sections/ApiConfigurationSection.tsx",
    "remote-ui/src/components/settings/OpenRouterModelPicker.tsx",
    "remote-ui/src/components/settings/HicapModelPicker.tsx",
    "remote-ui/src/components/settings/providers/OpenAICompatible.tsx",
    "remote-ui/src/components/settings/providers/HicapProvider.tsx",
    "remote-ui/src/components/settings/providers/AskSageProvider.tsx",
    "remote-ui/src/components/settings/providers/LMStudioProvider.tsx",
    "remote-ui/src/components/settings/providers/RequestyProvider.tsx",
    "remote-ui/src/components/settings/providers/OpenRouterProvider.tsx",
    "remote-ui/src/components/settings/providers/VSCodeLmProvider.tsx",
    "remote-ui/src/components/settings/providers/AihubmixProvider.tsx",
    "remote-ui/src/components/settings/providers/OllamaProvider.tsx",
    "remote-ui/src/components/settings/providers/OpenAiCodexProvider.tsx",
    "remote-ui/src/components/settings/providers/OcaProvider.tsx",
    "remote-ui/src/components/settings/providers/SapAiCoreProvider.tsx",
    "remote-ui/src/components/settings/RequestyModelPicker.tsx",
    "remote-ui/src/components/settings/SettingsView.tsx",
    "remote-ui/src/components/settings/utils/settingsHandlers.ts",
    "remote-ui/src/components/settings/ApiOptions.tsx",
    "remote-ui/src/components/settings/CodemarieAccountInfoCard.tsx",
    "remote-ui/src/components/settings/HuggingFaceModelPicker.tsx",
    "remote-ui/src/components/settings/CodemarieModelPicker.tsx",
    "remote-ui/src/components/chat/task-header/buttons/OpenDiskConversationHistoryButton.tsx",
    "remote-ui/src/components/chat/task-header/TaskHeader.stories.tsx",
    "remote-ui/src/components/chat/HookMessage.tsx",
    "remote-ui/src/components/chat/ChatTextArea.tsx",
    "remote-ui/src/components/chat/OptionsButtons.tsx",
    "remote-ui/src/components/chat/auto-approve-menu/AutoApproveSettingsAPI.ts",
    "remote-ui/src/components/chat/chat-view/components/messages/ToolGroupRenderer.tsx",
    "remote-ui/src/components/chat/chat-view/components/layout/IdleIndicator.stashed.tsx",
    "remote-ui/src/components/chat/chat-view/components/layout/WelcomeSection.tsx",
    "remote-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts",
    "remote-ui/src/components/chat/ChatRow.tsx",
    "remote-ui/src/components/chat/CreditLimitError.tsx",
    "remote-ui/src/components/chat/ReportBugPreview.tsx",
    "remote-ui/src/components/chat/BrowserSessionRow.tsx",
    "remote-ui/src/components/chat/DiffEditRow.tsx",
    "remote-ui/src/components/chat/ServersToggleModal.tsx",
    "remote-ui/src/components/chat/UserMessage.tsx",
    "remote-ui/src/components/chat/ChatView.tsx",
    "remote-ui/src/components/chat/TaskFeedbackButtons.tsx",
    "remote-ui/src/components/chat/CommandOutputRow.tsx",
    "remote-ui/src/components/chat/CompletionOutputRow.tsx",
    "remote-ui/src/components/chat/ChatErrorBoundary.tsx",
    "remote-ui/src/components/mcp/configuration/tabs/marketplace/McpMarketplaceCard.tsx",
    "remote-ui/src/components/mcp/configuration/tabs/marketplace/McpMarketplaceView.tsx",
    "remote-ui/src/components/mcp/configuration/tabs/installed/ConfigureServersView.tsx",
    "remote-ui/src/components/mcp/configuration/tabs/installed/server-row/McpToolRow.tsx",
    "remote-ui/src/components/mcp/configuration/tabs/installed/server-row/ServerRow.tsx",
    "remote-ui/src/components/mcp/configuration/tabs/add-server/AddLocalServerForm.tsx",
    "remote-ui/src/components/mcp/configuration/tabs/add-server/AddRemoteServerForm.tsx",
    "remote-ui/src/components/mcp/configuration/McpConfigurationView.tsx",
    "remote-ui/src/components/mcp/chat-display/LinkPreview.tsx",
    "remote-ui/src/components/mcp/chat-display/utils/mcpRichUtil.ts",
    "remote-ui/src/components/mcp/chat-display/McpResponseDisplay.tsx",
    "remote-ui/src/components/mcp/chat-display/ImagePreview.tsx",
    "remote-ui/src/components/mcp/chat-display/McpResponseDisplay.stories.tsx",
    "remote-ui/src/components/welcome/HomeHeader.tsx",
    "remote-ui/src/components/welcome/WelcomeView.tsx",
    "remote-ui/src/components/browser/BrowserSettingsMenu.tsx",
    "remote-ui/src/components/common/CheckpointControls.tsx",
    "remote-ui/src/components/common/MermaidBlock.tsx",
    "remote-ui/src/components/common/MarkdownBlock.stories.tsx",
    "remote-ui/src/components/common/Tab.tsx",
    "remote-ui/src/components/common/TelemetryBanner.tsx",
    "remote-ui/src/components/common/Thumbnails.tsx",
    "remote-ui/src/components/common/CopyButton.tsx",
    "remote-ui/src/components/common/CheckmarkControl.tsx",
    "remote-ui/src/components/worktrees/CreateWorktreeModal.tsx",
    "remote-ui/src/components/worktrees/WorktreesView.tsx",
    "remote-ui/src/components/menu/Navbar.tsx",
    "remote-ui/src/components/history/HistoryViewItem.tsx",
    "remote-ui/src/components/history/HistoryView.tsx",
    "remote-ui/src/components/history/HistoryPreview.tsx",
    "remote-ui/src/components/codemarie-rules/RuleRow.tsx",
    "remote-ui/src/components/codemarie-rules/HookRow.tsx",
    "remote-ui/src/components/codemarie-rules/NewRuleRow.tsx",
    "remote-ui/src/components/codemarie-rules/CodemarieRulesToggleModal.tsx",
    "remote-ui/src/components/account/AccountView.tsx",
    "remote-ui/src/services/grpc-client-base.ts",
    "remote-ui/vite.config.ts"
]

def process_file(file_path):
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return False
    
    with open(file_path, 'r') as f:
        lines = f.readlines()
    
    new_lines = []
    modified = False
    
    # Simple state machine to avoid adding multiple ignores
    i = 0
    while i < len(lines):
        line = lines[i]
        # Match console.log or console.error that is NOT already ignored
        # We also check if it's not a comment itself or part of a string (simplistic)
        if ('console.log' in line or 'console.error' in line) and "biome-ignore" not in line and "//" not in line.split("console.")[0]:
            # Check if previous line is already an ignore comment (even if different)
            if i > 0 and "biome-ignore lint/suspicious/noConsole" in lines[i-1]:
                new_lines.append(line)
            else:
                # Determine indentation
                indent_match = re.match(r'^(\s*)', line)
                indent = indent_match.group(1) if indent_match else ""
                new_lines.append(f"{indent}{IGNORE_TEXT}\n")
                new_lines.append(line)
                modified = True
        else:
            new_lines.append(line)
        i += 1
    
    if modified:
        with open(file_path, 'w') as f:
            f.writelines(new_lines)
        print(f"Modified: {file_path}")
        return True
    return False

for file_path in FILES:
    process_file(file_path)
