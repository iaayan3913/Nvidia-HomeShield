from backend.llm_client import LLMClient
print(LLMClient().complete([{"role": "user", "content": "Reply READY"}]))
