"""
Interactive streaming chatbot using local Ollama.

Configuration is loaded from environment variables or .env file,
matching the blog studio settings:
- OLLAMA_HOST: Ollama API URL (default: http://localhost:11434)
- OLLAMA_MODEL: Model name (default: llama3.2)
- OLLAMA_MAX_TOKENS: Max generation tokens (default: 4096)
- OLLAMA_TIMEOUT_SECONDS: Request timeout in seconds (default: 300)
- OLLAMA_TEMPERATURE: Sampling temperature (default: 0.6)
- OLLAMA_NUM_CTX: Context window size (default: 4096)
- OLLAMA_PROMPT_PERSONA: Persona/identity instructions
- OLLAMA_PROMPT_REQUIREMENTS: Output style constraints
"""

import os
import sys
import json
from typing import Generator, List, Dict, Optional
import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


# Default configurations
DEFAULT_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
DEFAULT_MAX_TOKENS = int(os.getenv("OLLAMA_MAX_TOKENS", "4096"))
DEFAULT_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "300"))
DEFAULT_TEMPERATURE = float(os.getenv("OLLAMA_TEMPERATURE", "0.6"))
DEFAULT_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "4096"))
DEFAULT_PERSONA = os.getenv(
    "OLLAMA_PROMPT_PERSONA",
    "You are an experienced SEO blog writer. Write clearly and helpfully, in simple English."
)
DEFAULT_REQUIREMENTS = os.getenv("OLLAMA_PROMPT_REQUIREMENTS", "- Keep paragraphs short.")


class OllamaChatbot:
    """Chatbot client for Ollama with streaming support and conversational memory."""

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        model: str = DEFAULT_MODEL,
        temperature: float = DEFAULT_TEMPERATURE,
        num_ctx: int = DEFAULT_NUM_CTX,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        timeout: int = DEFAULT_TIMEOUT,
        persona: str = DEFAULT_PERSONA,
        requirements: str = DEFAULT_REQUIREMENTS,
    ):
        self.host = host.rstrip("/")
        self.model = model
        self.temperature = temperature
        self.num_ctx = num_ctx
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.persona = persona
        self.requirements = requirements

        self.messages: List[Dict[str, str]] = []
        self._init_history()

    def _build_system_prompt(self) -> str:
        parts = []
        if self.persona:
            parts.append(self.persona.strip())
        if self.requirements:
            parts.append(f"Requirements:\n{self.requirements.strip()}")
        return "\n\n".join(parts)

    def _init_history(self) -> None:
        self.messages = []
        system_prompt = self._build_system_prompt()
        if system_prompt:
            self.messages.append({"role": "system", "content": system_prompt})

    def clear_history(self) -> None:
        """Reset conversation back to initial state with system prompt."""
        self._init_history()

    def stream_chat(self, user_message: str) -> Generator[str, None, str]:
        """
        Sends user message to Ollama with streaming enabled.
        Yields tokens as they arrive, and returns the complete assistant response.
        """
        self.messages.append({"role": "user", "content": user_message})

        endpoint = f"{self.host}/api/chat"
        payload = {
            "model": self.model,
            "messages": self.messages,
            "stream": True,
            "options": {
                "temperature": self.temperature,
                "num_ctx": self.num_ctx,
                "num_predict": self.max_tokens,
            },
        }

        full_response = []
        try:
            response = requests.post(
                endpoint,
                json=payload,
                stream=True,
                timeout=self.timeout
            )
            response.raise_for_status()

            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if "message" in chunk and "content" in chunk["message"]:
                    token = chunk["message"]["content"]
                    full_response.append(token)
                    yield token

                if chunk.get("done", False):
                    break

            complete_content = "".join(full_response)
            self.messages.append({"role": "assistant", "content": complete_content})
            return complete_content

        except requests.exceptions.RequestException as e:
            # If an error occurs, pop user message so history isn't left in a bad state
            if self.messages and self.messages[-1].get("role") == "user":
                self.messages.pop()
            raise e

    def check_connection(self) -> bool:
        """Verify that Ollama is running and responsive."""
        try:
            res = requests.get(f"{self.host}/api/tags", timeout=5)
            return res.status_code == 200
        except Exception:
            return False


def main():
    bot = OllamaChatbot()

    print("=" * 60)
    print(f"🤖 Ollama Streaming Chatbot")
    print(f"   Model       : {bot.model}")
    print(f"   Host        : {bot.host}")
    print(f"   Temperature : {bot.temperature}")
    print(f"   Persona     : {bot.persona}")
    print("=" * 60)
    print("Commands:")
    print("  /clear - Clear chat memory")
    print("  /exit  - Exit chatbot")
    print("  /help  - Show help")
    print("=" * 60)

    # Check connection upfront
    if not bot.check_connection():
        print(f"\n[Warning] Could not reach Ollama at {bot.host}.")
        print("Please ensure Ollama is running (e.g. `ollama serve`).")
        print("Continuing anyway...\n")

    while True:
        try:
            user_input = input("\nYou: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye!")
            break

        if not user_input:
            continue

        command = user_input.lower()
        if command in ("/exit", "/quit", "exit", "quit"):
            print("Goodbye!")
            break
        elif command == "/clear":
            bot.clear_history()
            print("Conversation history cleared.")
            continue
        elif command == "/help":
            print("\nAvailable commands:")
            print("  /clear - Clear chat history and restart conversation")
            print("  /exit  - Quit the chatbot")
            print("  /help  - Show this help message")
            continue

        sys.stdout.write("\nAssistant: ")
        sys.stdout.flush()

        try:
            for token in bot.stream_chat(user_input):
                sys.stdout.write(token)
                sys.stdout.flush()
            sys.stdout.write("\n")
            sys.stdout.flush()
        except requests.exceptions.ConnectionError:
            print(f"\n[Error] Unable to connect to Ollama at {bot.host}.")
            print("Check that Ollama is running (`ollama serve` or open Ollama desktop).")
        except requests.exceptions.HTTPError as e:
            print(f"\n[HTTP Error] {e}")
        except Exception as e:
            print(f"\n[Error] {e}")


if __name__ == "__main__":
    main()
