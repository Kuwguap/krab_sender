"""
AI-powered validation of client details.

Uses OpenAI to detect missing fields (e.g. vehicle color) and returns
a prompt asking the user to add them, or None if the details are complete.
"""

import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Expected fields for client details (delivery context)
EXPECTED_FIELDS = ["phone", "name", "delivery address", "vehicle color"]

SYSTEM_PROMPT = """You are a validator for delivery client details. The user will paste text that should contain:
- phone number
- client/customer name
- delivery address
- vehicle color

Analyze the text and determine which of these fields are MISSING or unclear. Respond with a JSON object:
{
  "complete": true or false,
  "missing": ["list of missing field names in plain English, e.g. 'vehicle color'"],
  "prompt": "A short, friendly message asking the user to add the missing info. Example: 'You missed out the vehicle color. Can you add it?'"
}

If all fields are present and clear, set "complete": true, "missing": [], "prompt": null.
If something is missing, set "complete": false and provide "missing" and "prompt".
Keep the prompt brief and conversational."""

USER_PROMPT_TEMPLATE = """Analyze this client details text and check if it has phone, name, delivery address, and vehicle color:

---
{text}
---"""


async def validate_client_details(
    client_details_text: str,
    openai_api_key: str,
) -> Optional[str]:
    """
    Use OpenAI to validate client details. Returns a prompt string to send
    the user if something is missing (e.g. vehicle color), or None if complete.
    """
    if not openai_api_key or not client_details_text.strip():
        return None

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": USER_PROMPT_TEMPLATE.format(text=client_details_text)},
            ],
            temperature=0.2,
        )
        content = (response.choices[0].message.content or "").strip()
        if not content:
            return None

        # Parse JSON from response (handle markdown code blocks)
        if "```" in content:
            start = content.find("```")
            end = content.find("```", start + 3)
            content = content[start + 3 : end] if end > start else content
        content = content.replace("```json", "").replace("```", "").strip()

        data = json.loads(content)
        if data.get("complete"):
            return None
        prompt = data.get("prompt")
        if prompt:
            logger.info("Validation found missing fields: %s", data.get("missing", []))
            return prompt
        return None

    except json.JSONDecodeError as e:
        logger.warning("Could not parse OpenAI validation response: %s", e)
        return None
    except Exception as e:
        logger.warning("OpenAI validation failed: %s", e)
        return None
