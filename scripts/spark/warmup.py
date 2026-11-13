from backend.llm_client import AgentLLMClient

print(AgentLLMClient().complete([{"role": "user", "content": "Reply READY"}]))
