from backend.config import (
    AGENT_API_KEY, AGENT_BASE_URL, AGENT_CHAT_TEMPLATE_CONTROL, AGENT_ENABLE_THINKING, AGENT_MODEL,
    LLM_API_KEY, LLM_BASE_URL, LLM_MODEL,
)


class LLMError(RuntimeError):
    pass


class LLMClient:
    """OpenAI-compatible client; defaults remain the established intake settings."""

    def __init__(self, base_url=LLM_BASE_URL, api_key=LLM_API_KEY, model=LLM_MODEL):
        self.base_url, self.api_key, self.model = base_url, api_key, model

    def complete(self, messages: list[dict], **kwargs) -> dict:
        try:
            from openai import OpenAI
            response = OpenAI(base_url=self.base_url, api_key=self.api_key or "not-needed").chat.completions.create(
                model=self.model, messages=messages,
                max_tokens=max(2048, kwargs.pop("max_tokens", 2048)), **kwargs)
            message = response.choices[0].message
            content = message.content
            if not content:
                raise LLMError("Model returned no content; reasoning tokens may have exhausted max_tokens")
            return {"content": content, "reasoning": getattr(message, "reasoning_content", None)}
        except LLMError:
            raise
        except Exception as exc:
            raise LLMError(f"LLM request failed ({type(exc).__name__})") from exc


class AgentLLMClient(LLMClient):
    """Nemotron Lightning client, separate from the Nano Omni intake endpoint."""

    def __init__(self, base_url=AGENT_BASE_URL, api_key=AGENT_API_KEY, model=AGENT_MODEL,
                 enable_thinking=AGENT_ENABLE_THINKING,
                 chat_template_control=AGENT_CHAT_TEMPLATE_CONTROL):
        super().__init__(base_url=base_url, api_key=api_key, model=model)
        self.enable_thinking = enable_thinking
        if chat_template_control not in {"auto", "true", "false"}:
            raise ValueError("AGENT_CHAT_TEMPLATE_CONTROL must be auto, true or false")
        local_ollama = "11434" in base_url or "ollama" in base_url.lower()
        self.chat_template_control = (chat_template_control == "true" or
                                      (chat_template_control == "auto" and local_ollama))

    def complete(self, messages: list[dict], **kwargs) -> dict:
        # Ollama's OpenAI-compatible endpoint forwards this to the Lightning
        # chat template. Keep it on the agent client so Nano Omni intake is
        # unaffected.
        if self.chat_template_control:
            body = {"chat_template_kwargs": {"enable_thinking": self.enable_thinking}}
            if not self.enable_thinking:
                # Ollama ignores chat_template_kwargs for Nemotron Lightning; only reasoning_effort="none"
                # stops it spending the whole token budget on hidden reasoning (0.2 s vs. a timeout).
                body["reasoning_effort"] = "none"
            kwargs.setdefault("extra_body", body)
        return super().complete(messages, **kwargs)
