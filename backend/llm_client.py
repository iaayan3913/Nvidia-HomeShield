from backend.config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
class LLMError(RuntimeError): pass
class LLMClient:
    def __init__(self, base_url=LLM_BASE_URL, api_key=LLM_API_KEY, model=LLM_MODEL):
        self.base_url, self.api_key, self.model = base_url, api_key, model
    def complete(self, messages: list[dict], **kwargs) -> dict:
        try:
            from openai import OpenAI
            response = OpenAI(base_url=self.base_url, api_key=self.api_key or "not-needed").chat.completions.create(
                model=self.model, messages=messages, max_tokens=max(2048, kwargs.pop("max_tokens", 2048)), **kwargs)
            message = response.choices[0].message
            content = message.content
            if not content:
                raise LLMError("Model returned no content; reasoning tokens may have exhausted max_tokens")
            return {"content": content, "reasoning": getattr(message, "reasoning_content", None)}
        except LLMError:
            raise
        except Exception as exc:
            raise LLMError(f"LLM request failed: {exc}") from exc
