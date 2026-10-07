"""Modal-hosted GPU inference for Qwen3.8; no third-party model API.
Requires Modal secret riri-modal-auth with RIRI_MODAL_SECRET (>=32 chars).
GPU stays off between requests; Cloudflare cron does X inbox polling.
"""
import os
import hmac
import modal
from fastapi import Request

APP_NAME = "riri-qwen38-on-demand"
MODEL_ID = "Qwen/Qwen3.8-27B-FP8"
app = modal.App(APP_NAME)
gpu_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "vllm>=0.11.0", "transformers", "huggingface_hub"
)
web_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi")
cache = modal.Volume.from_name("riri-qwen38-hf-cache", create_if_missing=True)


@app.cls(
    image=gpu_image,
    gpu="L40S",
    cpu=2,
    memory=8192,
    min_containers=0,
    max_containers=1,
    scaledown_window=90,
    startup_timeout=900,
    timeout=600,
    volumes={"/cache": cache},
)
class QwenModel:
    @modal.enter()
    def load(self):
        os.environ["HF_HOME"] = "/cache"
        from vllm import LLM
        self.llm = LLM(
            model=MODEL_ID,
            trust_remote_code=False,
            dtype="auto",
            max_model_len=4096,
            gpu_memory_utilization=0.90,
            tensor_parallel_size=1,
        )
        cache.commit()

    @modal.method()
    def respond(self, messages: list[dict]) -> str:
        from vllm import SamplingParams
        params = SamplingParams(temperature=0.7, top_p=0.8, max_tokens=320)
        answer = self.llm.chat(
            messages,
            sampling_params=params,
            use_tqdm=False,
            chat_template_kwargs={"enable_thinking": False, "preserve_thinking": False},
        )
        text = answer[0].outputs[0].text.strip()
        import re
        text = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()
        if not text or len(text) > 4000:
            raise ValueError("Invalid model output")
        return text


@app.function(
    image=web_image,
    cpu=0.125,
    memory=256,
    timeout=900,
    min_containers=0,
    secrets=[modal.Secret.from_name("riri-modal-auth")],
)
@modal.fastapi_endpoint(method="POST")
async def chat(request: Request):
    """FastAPI parses JSON payload; authorization is an HTTP header."""
    from fastapi import HTTPException
    secret = os.environ.get("RIRI_MODAL_SECRET", "")
    if len(secret) < 32 or not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + secret):
        raise HTTPException(status_code=403, detail="Forbidden")
    payload = await request.json()
    messages = payload.get("messages") if isinstance(payload, dict) else None
    if not isinstance(messages, list) or not 1 <= len(messages) <= 20:
        raise HTTPException(status_code=400, detail="Invalid messages")
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in ("system", "user", "assistant") or not isinstance(message.get("content"), str) or len(message["content"]) > 8000:
            raise HTTPException(status_code=400, detail="Invalid message")
    return {"reply": await QwenModel().respond.remote.aio(messages)}
