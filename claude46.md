Claude Sonnet 4.6
Anthropic
Text Generation
LLM
Coding
Reasoning
Agentic
anthropic/claude-sonnet-4.6
Claude Sonnet 4.6 is Anthropic's latest balanced model offering strong coding, reasoning, and agentic capabilities with improved instruction following.

Quick Start
0

TypeScript
const response = await env.AI.run(
  'anthropic/claude-sonnet-4.6',
  {
    messages: [
      {
        role: 'user',
        content: 'What are the three laws of thermodynamics?',
      },
    ],
    max_tokens: 1024,
  },
  {
    gateway: { id: 'default' },
  }
)
console.log(response)
Bindings don't require an API token.

API Details
Parameters
API Schema
Input
messages
object[] (required)
max_tokens
number (required)
system
string
temperature
number
top_p
number
top_k
number
stream
boolean
metadata
object
Output
id
string
type
"message"
role
"assistant"
content
object[]
model
string
stop_reason
string | null

usage
object (2)