from openai import OpenAI

client = OpenAI(
  base_url="https://openrouter.ai/api/v1",
  api_key="<OPENROUTER_API_KEY>",
)

completion = client.chat.completions.create(
  extra_headers={
    "HTTP-Referer": "https://mariecoder.com", # Required. Site URL for rankings on openrouter.ai.
    "X-OpenRouter-Title": "LUMI", # App display name in rankings and analytics.
    "X-OpenRouter-Categories": "ide-extension", # Marketplace category (up to 2 per request).
  },
  model="openai/gpt-4o",
  messages=[
    {
      "role": "user",
      "content": "What is the meaning of life?"
    }
  ]
)

print(completion.choices[0].message.content)
